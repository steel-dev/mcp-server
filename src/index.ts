#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CallToolResult,
  TextContent,
  ImageContent,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer, { Browser, Page } from "puppeteer";
import { Steel } from "steel-sdk";
import dotenv from "dotenv";

dotenv.config();

// -----------------------------------------------------------------------------
// Environment Variables
// -----------------------------------------------------------------------------
const steelLocal = process.env.STEEL_LOCAL === "true";
const steelKey = process.env.STEEL_API_KEY || undefined;
const globalWaitSeconds = Number(process.env.GLOBAL_WAIT_SECONDS) || 0;

/**
 * STEEL_BASE_URL is for self-hosted or custom Steel endpoints.
 * By default, set it to the public cloud endpoint (https://api.steel.dev).
 * If STEEL_LOCAL is true and no STEEL_BASE_URL is specified,
 * we'll default to http://localhost:3000.
 */
let steelBaseURL = process.env.STEEL_BASE_URL || "https://api.steel.dev";
if (steelLocal && !process.env.STEEL_BASE_URL) {
  steelBaseURL = "http://localhost:3000";
}

// -----------------------------------------------------------------------------
// Logging / Debug Info
// -----------------------------------------------------------------------------
console.error(
  JSON.stringify({
    message: "Initializing MCP server",
    config: {
      steelLocal,
      hasSteelKey: !!steelKey,
      globalWaitSeconds,
      nodeVersion: process.version,
      platform: process.platform,
      steelBaseURL,
    },
  })
);

// -----------------------------------------------------------------------------
// Globals and Utilities
// -----------------------------------------------------------------------------
const screenshots = new Map<string, Buffer>();
const consoleLogs: string[] = [];

// Define the marking script (truncated for brevity here)
const markPageScript = `
  if (typeof window.labels === 'undefined') {
    window.labels = [];
  }

  function unmarkPage() {
    for (const label of window.labels) {
      document.body.removeChild(label);
    }
    window.labels = [];

    const labeledElements = document.querySelectorAll('[data-label]');
    labeledElements.forEach(el => el.removeAttribute('data-label'));
  }

  function markPage() {
    unmarkPage();
    var items = Array.from(document.querySelectorAll("a, button, input, select, textarea, [role='button'], [role='link']"))
      .map(function (element) {
        var vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        var vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        var textualContent = element.textContent?.trim().replace(/\\s{2,}/g, " ") || "";
        var elementType = element.tagName.toLowerCase();
        var ariaLabel = element.getAttribute("aria-label") || "";

        var rect = element.getBoundingClientRect();
        var bbox = {
          left: Math.max(0, rect.left),
          top: Math.max(0, rect.top),
          right: Math.min(vw, rect.right),
          bottom: Math.min(vh, rect.bottom),
          width: Math.min(vw, rect.right) - Math.max(0, rect.left),
          height: Math.min(vh, rect.bottom) - Math.max(0, rect.top)
        };

        return {
          element,
          include:
            element.tagName === "INPUT" ||
            element.tagName === "TEXTAREA" ||
            element.tagName === "SELECT" ||
            element.tagName === "BUTTON" ||
            element.tagName === "A" ||
            element.onclick != null ||
            window.getComputedStyle(element).cursor == "pointer" ||
            element.tagName === "IFRAME" ||
            element.tagName === "VIDEO",
          bbox,
          rects: [bbox],
          text: textualContent,
          type: elementType,
          ariaLabel
        };
      })
      .filter(item => item.include && item.bbox.width * item.bbox.height >= 20);

    items = items.filter(
      (x) => !items.some((y) => x.element.contains(y.element) && x !== y)
    );

    items.forEach((item, index) => {
      item.element.setAttribute("data-label", index.toString());

      item.rects.forEach((bbox) => {
        const newElement = document.createElement("div");
        const borderColor = '#' + Math.floor(Math.random()*16777215).toString(16);
        newElement.style.outline = \`2px dashed \${borderColor}\`;
        newElement.style.position = "fixed";
        newElement.style.left = bbox.left + "px";
        newElement.style.top = bbox.top + "px";
        newElement.style.width = bbox.width + "px";
        newElement.style.height = bbox.height + "px";
        newElement.style.pointerEvents = "none";
        newElement.style.boxSizing = "border-box";
        newElement.style.zIndex = "2147483647";

        const label = document.createElement("span");
        label.textContent = index.toString();
        label.style.position = "absolute";
        const hasSpaceAbove = bbox.top >= 20;
        if (hasSpaceAbove) {
            label.style.top = "-19px";
            label.style.left = "0px";
        } else {
            label.style.top = "0px";
            label.style.left = "0px";
        }
        label.style.background = borderColor;
        label.style.color = "white";
        label.style.padding = "2px 4px";
        label.style.fontSize = "12px";
        label.style.borderRadius = "2px";
        label.style.zIndex = "2147483647";
        newElement.appendChild(label);

        document.body.appendChild(newElement);
        window.labels.push(newElement);
      });
    });

    return items.map((item) => ({
      x: item.bbox.left + item.bbox.width / 2,
      y: item.bbox.top + item.bbox.height / 2,
      type: item.type,
      text: item.text,
      ariaLabel: item.ariaLabel,
    }));
  }
`;

/**
 * Sleep for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// SteelSessionManager Class
// -----------------------------------------------------------------------------
class SteelSessionManager {
  private sessionId: string | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isInitialized = false;

  constructor(
    private readonly steelLocal: boolean,
    private readonly steelKey: string | undefined,
    private readonly globalWaitSeconds: number
  ) {
    // Ensure STEEL_LOCAL is defined (should be "true" or "false").
    if (typeof process.env.STEEL_LOCAL === "undefined") {
      throw new Error(
        "STEEL_LOCAL environment variable is not defined. Must be 'true' or 'false'."
      );
    }

    // If in cloud mode (STEEL_LOCAL=false), ensure we have a Steel API key.
    if (!this.steelLocal && !this.steelKey) {
      throw new Error("STEEL_API_KEY must be set when STEEL_LOCAL is 'false'.");
    }
  }

  /**
   * Creates or recreates a Steel session. Called from createNewSession().
   */
  private async createSteelSession(timeoutMs: number = 900000): Promise<{
    id: string;
    websocketUrl: string;
    status: "live" | "released" | "failed";
  }> {
    try {
      const response = await fetch(`${steelBaseURL}/v1/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Only include the steel-api-key header if we actually have one
          ...(this.steelKey ? { "steel-api-key": this.steelKey } : {}),
        },
        body: JSON.stringify({
          timeout: timeoutMs, // 15 minute default
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        id: data.id,
        websocketUrl: data.websocketUrl,
        status: data.status,
      };
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Error creating Steel session",
          error: (error as Error).message,
        })
      );
      throw error;
    }
  }

  /**
   * Public method to initialize the session and return a Puppeteer Page.
   */
  async initialize(): Promise<Page> {
    if (this.isInitialized) {
      return this.page!;
    }
    try {
      await this.createNewSession();
      this.isInitialized = true;
      return this.page!;
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Failed to initialize session",
          error: (error as Error).message,
          stack: (error as Error).stack,
        })
      );
      throw error;
    }
  }

  /**
   * Ensures that we have a valid session. If we don't, initialize one.
   */
  async ensureSession(): Promise<Page> {
    if (!this.sessionId) {
      return this.initialize();
    }
    return this.page!;
  }

  /**
   * Creates a new session, connecting Puppeteer to the correct endpoint
   * (local or cloud).
   */
  private async createNewSession(): Promise<void> {
    // If there's already a browser, clean up first
    if (this.browser) {
      await this.cleanup();
    }

    console.error(
      JSON.stringify({
        message: this.steelLocal
          ? "Local mode. Creating a local session..."
          : "Cloud mode. Creating a remote session...",
      })
    );

    // Create a Steel session in both local and cloud modes
    const session = await this.createSteelSession(900000); // 15 minute session
    this.sessionId = session.id;

    console.error(
      JSON.stringify({
        message: "New session created with 15 minute timeout",
        sessionId: this.sessionId,
      })
    );

    // Connect Puppeteer to the appropriate WebSocket
    if (this.steelLocal) {
      // Local WebSocket endpoint
      const lowercaseBaseURL = steelBaseURL.toLowerCase();
      let browserWSEndpoint;
      if (lowercaseBaseURL.startsWith("http://")) {
        browserWSEndpoint = `${steelBaseURL.replace("http://", "ws://")}/?sessionId=${this.sessionId}`;
      }
      else if (lowercaseBaseURL.startsWith("https://")) {
        browserWSEndpoint = `${steelBaseURL.replace("https://", "wss://")}/?sessionId=${this.sessionId}`;
      }
      else {
        throw new Error("Invalid Steel base URL");
      }
      console.error(JSON.stringify({
        message: "Connecting to Steel session",
        browserWSEndpoint,
      }));
      this.browser = await puppeteer.connect({ browserWSEndpoint });
    } else {
      // Cloud WebSocket endpoint
      const browserWSEndpoint = `wss://connect.steel.dev?sessionId=${
        this.sessionId
      }${this.steelKey ? `&apiKey=${this.steelKey}` : ""}`;
      this.browser = await puppeteer.connect({ browserWSEndpoint });
    }

    // Grab the initial page and set it up
    const pages = await this.browser.pages();
    this.page = pages[0];
    await this.setupPage();
  }

  /**
   * Injects the marking script into the current page and applies it.
   */
  async injectMarkPageScript(): Promise<void> {
    if (!this.page) return;

    // Inject the marking script on new documents
    await this.page.evaluateOnNewDocument(markPageScript);
    // Execute the script right away on the current DOM
    await this.page.evaluate(`${markPageScript}; markPage();`);
  }

  /**
   * Sets up the Puppeteer Page with viewport, console logging, etc.
   */
  private async setupPage(): Promise<void> {
    if (!this.page) return;

    // Initial script injection
    await this.injectMarkPageScript();

    // Set a default viewport size
    await this.page.setViewport({ width: 1280, height: 720 });

    // Listen for console logs from the browser
    this.page.on("console", (msg) => {
      const message = msg.text();
      console.error(`Browser console: ${message}`);
      consoleLogs.push(message);
    });
  }

  /**
   * Attempts to handle session errors, e.g. if a session is not live anymore.
   * Returns true if it recreates the session.
   */
  async handleError(error: Error): Promise<boolean> {
    try {
      if (!this.sessionId) {
        // If there's no session at all, let the caller handle it
        return false;
      }
      const session = await steel.sessions.retrieve(this.sessionId);
      if (session.status !== "live") {
        await this.createNewSession();
        return true;
      }
      return false;
    } catch (e) {
      // If we can't retrieve the session, try to create a new one
      await this.createNewSession();
      return true;
    }
  }

  /**
   * Cleans up resources including the session on steel.dev if in cloud mode,
   * and closes the Puppeteer browser.
   */
  async cleanup(): Promise<void> {
    try {
      if (!this.steelLocal && this.sessionId) {
        // Release the session in non-local mode
        await steel.sessions.release(this.sessionId);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Error releasing session",
          error: (error as Error).message,
        })
      );
    }

    if (this.browser) {
      await this.browser.close().catch(console.error);
    }
    this.sessionId = null;
    this.browser = null;
    this.page = null;
    this.isInitialized = false;
  }
}

// -----------------------------------------------------------------------------
// Initialize Steel SDK
// -----------------------------------------------------------------------------
/**
 * We'll omit the API key if we don't have it (in local mode).
 */
const steelConfig: { baseURL: string; steelAPIKey?: string } = {
  baseURL: steelBaseURL,
};
if (steelKey) {
  steelConfig.steelAPIKey = steelKey;
}

const steel = new Steel(steelConfig);

// -----------------------------------------------------------------------------
// Create a SessionManager instance
// -----------------------------------------------------------------------------
const sessionManager = new SteelSessionManager(
  steelLocal,
  steelKey,
  globalWaitSeconds
);

// -----------------------------------------------------------------------------
// Define Tools
// -----------------------------------------------------------------------------
const TOOLS: Tool[] = [
  {
    name: "navigate",
    description: "Navigate to a specified URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to navigate to" },
      },
      required: ["url"],
    },
  },
  {
    name: "search",
    description:
      "Perform a Google search by navigating to https://www.google.com/search?q=encodedQuery using the provided query text.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The text to search for on Google",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "click",
    description:
      "Click an element on the page specified by its numbered label from the annotated screenshot",
    inputSchema: {
      type: "object",
      properties: {
        label: {
          type: "number",
          description:
            "The label of the element to click, as shown in the annotated screenshot",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "type",
    description:
      "Type text into an input field specified by its numbered label from the annotated screenshot. Optionally replace existing text first.",
    inputSchema: {
      type: "object",
      properties: {
        label: {
          type: "number",
          description: "The label of the input field",
        },
        text: {
          type: "string",
          description: "The text to type into the input field",
        },
        replaceText: {
          type: "boolean",
          description:
            "If true, clears any existing text in the input field before typing the new text.",
        },
      },
      required: ["label", "text"],
    },
  },
  {
    name: "scroll_down",
    description:
      "Scroll down the page by a pixel amount - if no pixels are specified, scrolls down one page",
    inputSchema: {
      type: "object",
      properties: {
        pixels: {
          type: "integer",
          description:
            "The number of pixels to scroll down. If not specified, scrolls down one page.",
        },
      },
      required: [],
    },
  },
  {
    name: "scroll_up",
    description:
      "Scroll up the page by a pixel amount - if no pixels are specified, scrolls up one page",
    inputSchema: {
      type: "object",
      properties: {
        pixels: {
          type: "integer",
          description:
            "The number of pixels to scroll up. If not specified, scrolls up one page.",
        },
      },
      required: [],
    },
  },
  {
    name: "go_back",
    description: "Go back to the previous page in the browser history",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "wait",
    description:
      "Use this tool when a page appears to be loading or not fully rendered. Common scenarios include: when elements are missing from a screenshot that should be there, when a page looks incomplete or broken, when dynamic content is still loading, or when a previous action (like clicking a button) hasn't fully processed yet. Waits for a specified number of seconds (up to 10) to allow the page to finish loading or rendering.",
    inputSchema: {
      type: "object",
      properties: {
        seconds: {
          type: "number",
          description:
            "Number of seconds to wait (max 10). Start with a smaller value (2-3 seconds) and increase if needed.",
          minimum: 0,
          maximum: 10,
        },
      },
      required: ["seconds"],
    },
  },
  {
    name: "save_unmarked_screenshot",
    description:
      "Capture a screenshot without bounding boxes and store it as a resource. Provide a resourceName to identify the screenshot. It's useful for when you want to view a page unobstructed by annotations or the user asks for a screenshot of the page.",
    inputSchema: {
      type: "object",
      properties: {
        resourceName: {
          type: "string",
          description:
            "The name under which the unmarked screenshot will be saved as a resource (e.g. 'before_login'). If not provided, one will be generated.",
        },
      },
      required: [],
    },
  },
];

// -----------------------------------------------------------------------------
// Tool Handlers (Examples)
// -----------------------------------------------------------------------------
async function handleNavigate(page: Page, args: any): Promise<CallToolResult> {
  let { url } = args;
  if (!url) {
    return {
      isError: true,
      content: [
        { type: "text", text: "URL parameter is required for navigation" },
      ],
    };
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  await page.goto(url);
  return {
    isError: false,
    content: [{ type: "text", text: `Navigated to ${url}` }],
  };
}

/**
 * Handle "search" tool call
 */
async function handleSearch(page: Page, args: any): Promise<CallToolResult> {
  const { query } = args;
  if (!query) {
    return {
      isError: true,
      content: [
        { type: "text", text: "Query parameter is required for search" },
      ],
    };
  }
  const encodedQuery = encodeURIComponent(query);
  const url = `https://www.google.com/search?q=${encodedQuery}`;
  await page.goto(url);
  return {
    isError: false,
    content: [{ type: "text", text: `Searched Google for "${query}"` }],
  };
}

/**
 * Handle "click" tool call
 */
async function handleClick(page: Page, args: any): Promise<CallToolResult> {
  const { label } = args;
  if (!label) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Label parameter is required for clicking elements",
        },
      ],
    };
  }

  const selector = `[data-label="${label}"]`;
  try {
    // Wait for the element to be visible
    await page.waitForSelector(selector, { visible: true });

    // Evaluate if the element has a target="_blank" anchor
    type ClickResult =
      | { hasTargetBlank: true; href: string }
      | { hasTargetBlank: false };

    const result = await page.$eval(selector, (element): ClickResult => {
      const anchor = element.closest("a");
      if (anchor && anchor.target === "_blank" && anchor.href) {
        return { hasTargetBlank: true, href: anchor.href };
      }
      return { hasTargetBlank: false };
    });

    // If the element navigates to a new tab, go to that href instead
    if (result.hasTargetBlank) {
      await page.goto(result.href);
    } else {
      await page.click(selector);
    }

    // Success - no error content
    return {
      isError: false,
      content: [{ type: "text", text: `Clicked element with label ${label}.` }],
    };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Could not find clickable element with label ${label}. Error: ${
            (e as Error).message
          }`,
        },
      ],
    };
  }
}

/**
 * Handle "type" tool call
 */
async function handleType(page: Page, args: any): Promise<CallToolResult> {
  const { label, text, replaceText = false } = args;
  if (!label || !text) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Both label and text parameters are required for typing",
        },
      ],
    };
  }

  const selector = `[data-label="${label}"]`;
  try {
    await page.waitForSelector(selector, { visible: true });
  } catch {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Could not find input element with label ${label}.`,
        },
      ],
    };
  }

  // Option A: Directly set the value & dispatch events
  if (replaceText) {
    await page.$eval(
      selector,
      (el: Element, value: string) => {
        const input = el as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      text
    );
  } else {
    await page.$eval(
      selector,
      (el: Element, value: string) => {
        const input = el as HTMLInputElement;
        input.value = (input.value ?? "") + value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      text
    );
  }

  // Option B (Alternative): Use page.type() to simulate typing
  // An example if you want to more accurately emulate user typing:
  //   if (replaceText) {
  //     await page.click(selector, { clickCount: 3 }); // highlights existing text
  //     await page.type(selector, text);
  //   } else {
  //     await page.type(selector, text);
  //   }

  return {
    isError: false,
    content: [{ type: "text", text: `Typed '${text}' into label ${label}.` }],
  };
}

/**
 * Handle "scroll_down" tool call
 */
async function handleScrollDown(
  page: Page,
  args: any
): Promise<CallToolResult> {
  const { pixels } = args;
  if (pixels !== undefined) {
    await page.evaluate((scrollAmount) => {
      window.scrollBy(0, scrollAmount);
    }, pixels);
  } else {
    await page.keyboard.press("PageDown");
  }

  return {
    isError: false,
    content: [
      { type: "text", text: `Scrolled down by ${pixels ?? "one page"}` },
    ],
  };
}

/**
 * Handle "scroll_up" tool call
 */
async function handleScrollUp(page: Page, args: any): Promise<CallToolResult> {
  const { pixels } = args;
  if (pixels !== undefined) {
    await page.evaluate((scrollAmount) => {
      window.scrollBy(0, -scrollAmount);
    }, pixels);
  } else {
    await page.keyboard.press("PageUp");
  }

  return {
    isError: false,
    content: [{ type: "text", text: `Scrolled up by ${pixels ?? "one page"}` }],
  };
}

/**
 * Handle "go_back" tool call
 */
async function handleGoBack(page: Page): Promise<CallToolResult> {
  const response = await page.goBack({ waitUntil: "domcontentloaded" });
  if (!response) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Cannot go back. No previous page in the browser history.",
        },
      ],
    };
  }

  return {
    isError: false,
    content: [{ type: "text", text: "Went back to the previous page." }],
  };
}

/**
 * Handle "wait" tool call
 */
async function handleWait(_page: Page, args: any): Promise<CallToolResult> {
  const { seconds } = args;
  if (typeof seconds !== "number" || seconds < 0 || seconds > 10) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Wait time must be a number between 0 and 10 seconds",
        },
      ],
    };
  }

  await sleep(seconds * 1000); // Reusing your sleep utility
  return {
    isError: false,
    content: [{ type: "text", text: `Waited ${seconds} second(s).` }],
  };
}

/**
 * Handle "save_unmarked_screenshot" tool call
 */
async function handleSaveUnmarkedScreenshot(
  page: Page,
  args: any
): Promise<CallToolResult> {
  let { resourceName } = args;
  if (!resourceName) {
    resourceName = `unmarked_screenshot_${Date.now()}`;
  }

  // Unmark the page to remove bounding boxes
  await page.evaluate(() => {
    if (typeof (window as any).unmarkPage === "function") {
      (window as any).unmarkPage();
    }
  });

  const buffer = await page.screenshot();
  screenshots.set(resourceName, Buffer.from(buffer));

  return {
    isError: false,
    content: [
      {
        type: "text",
        text: `Unmarked screenshot saved as resource screenshot://${resourceName}`,
      },
    ],
  };
}

/**
 * Main dispatcher for handling tool calls
 */
async function handleToolCall(
  name: string,
  args: any
): Promise<CallToolResult> {
  const startTime = Date.now();

  try {
    // Ensure a valid session
    const page = await sessionManager.ensureSession();
    let result: CallToolResult;

    switch (name) {
      case "navigate":
        result = await handleNavigate(page, args);
        break;
      case "search":
        result = await handleSearch(page, args);
        break;
      case "click":
        result = await handleClick(page, args);
        break;
      case "type":
        result = await handleType(page, args);
        break;
      case "scroll_down":
        result = await handleScrollDown(page, args);
        break;
      case "scroll_up":
        result = await handleScrollUp(page, args);
        break;
      case "go_back":
        result = await handleGoBack(page);
        break;
      case "wait":
        result = await handleWait(page, args);
        break;
      case "save_unmarked_screenshot":
        result = await handleSaveUnmarkedScreenshot(page, args);
        break;
      default:
        result = {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}. Available tools are: ${TOOLS.map(
                (t) => t.name
              ).join(", ")}.`,
            },
          ],
        };
        break;
    }

    // If tool resulted in an error, just return it
    if (result.isError) {
      return result;
    }

    // Optionally wait a global number of seconds for slow pages
    if (globalWaitSeconds > 0) {
      await sleep(globalWaitSeconds * 1000);
    }

    // Re-inject marking script so bounding boxes are updated
    await sessionManager.injectMarkPageScript();

    // Capture updated annotated screenshot
    const screenshotBuffer = await page.screenshot();
    result.content.push({
      type: "image",
      data: Buffer.from(screenshotBuffer).toString("base64"),
      mimeType: "image/png",
    });

    console.error(
      JSON.stringify({
        message: `Action completed in ${Date.now() - startTime}ms`,
      })
    );

    return result;
  } catch (error) {
    // Attempt to recover if the session is no longer valid
    const wasSessionError = await sessionManager.handleError(error as Error);
    if (wasSessionError) {
      // We recreated the session, let the user try again
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "Browser session ended unexpectedly. A new session has been created. " +
              "Please retry your request.",
          },
        ],
      };
    }

    // Return the original error if we didn't recover
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Tool ${name} failed: ${
            (error as Error).message
          }\nStack trace: ${(error as Error).stack}`,
        },
      ],
    };
  }
}

// -----------------------------------------------------------------------------
// Create and Configure MCP Server
// -----------------------------------------------------------------------------
const server = new Server(
  {
    name: "web-voyager-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// -----------------------------------------------------------------------------
// Server Request Handlers
// -----------------------------------------------------------------------------
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    ...Array.from(screenshots.keys()).map((name) => ({
      uri: `screenshot://${name}`,
      mimeType: "image/png",
      name: `Screenshot: ${name}`,
    })),
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri.startsWith("screenshot://")) {
    const name = uri.split("://")[1];
    const screenshot = screenshots.get(name);
    if (screenshot) {
      return {
        contents: [
          {
            uri,
            mimeType: "image/png",
            blob: screenshot,
          },
        ],
      };
    }
  }
  throw new Error(`Resource not found: ${uri}`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  handleToolCall(request.params.name, request.params.arguments ?? {})
);

// -----------------------------------------------------------------------------
// Start the Server
// -----------------------------------------------------------------------------
async function runServer() {
  console.error(
    JSON.stringify({ message: "Starting Web Voyager MCP server..." })
  );
  const transport = new StdioServerTransport();

  try {
    console.error(
      JSON.stringify({ message: "Attempting to connect transport..." })
    );
    await server.connect(transport);
    console.error(JSON.stringify({ message: "Server successfully connected" }));
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Server connection error",
        error: (error as Error).message,
        stack: (error as Error).stack,
      })
    );
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// Graceful Shutdown
// -----------------------------------------------------------------------------
process.on("SIGINT", async () => {
  console.error(JSON.stringify({ message: "Received SIGINT, cleaning up..." }));
  await sessionManager.cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error(
    JSON.stringify({ message: "Received SIGTERM, cleaning up..." })
  );
  await sessionManager.cleanup();
  process.exit(0);
});

// -----------------------------------------------------------------------------
// Execute
// -----------------------------------------------------------------------------
runServer().catch((error) => {
  console.error("Unhandled error in server:", error);
  process.exit(1);
});
