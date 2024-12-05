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
import { encoding_for_model } from "tiktoken";

dotenv.config();

// Use environment variables
const steelLocal = process.env.STEEL_LOCAL === "true";
const steelKey = process.env.STEEL_API_KEY || undefined;

// Define the tools once to avoid repetition
const TOOLS: Tool[] = [
  {
    name: "puppeteer_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        timeout: {
          type: "number",
          description: "Navigation timeout in milliseconds (default: 60000)",
        },
        waitUntil: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
          description:
            "When to consider navigation succeeded (default: networkidle0)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "puppeteer_screenshot",
    description: "Take a screenshot of the current page or a specific element",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the screenshot" },
        selector: {
          type: "string",
          description: "CSS selector for element to screenshot (optional)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "puppeteer_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for element to click",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_fill",
    description: "Fill out an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for input field",
        },
        value: { type: "string", description: "Value to fill" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_select",
    description: "Select an element on the page with Select tag",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for element to select",
        },
        value: { type: "string", description: "Value to select" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_hover",
    description: "Hover an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for element to hover",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_evaluate",
    description: "Execute JavaScript in the browser console",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code to execute" },
      },
      required: ["script"],
    },
  },
  {
    name: "puppeteer_get_content",
    description: "Extract all content from the current page",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            "Optional CSS selector to get content from specific elements, only provide this if you're 100% sure that element will contain the content you need (default: returns whole page)",
          required: false,
        },
      },
      required: [],
    },
  },
  {
    name: "puppeteer_scroll",
    description: "Scroll the page to trigger lazy-loading",
    inputSchema: {
      type: "object",
      properties: {
        scrollDelay: {
          type: "number",
          description: "Delay between scrolls in milliseconds (default: 100)",
        },
        maxScrolls: {
          type: "number",
          description: "Maximum number of scrolls (default: 50)",
        },
      },
    },
  },
];

// Global state
let browser: Browser | undefined;
let page: Page | undefined;
const consoleLogs: string[] = [];
const screenshots = new Map<string, string>();
const steel = new Steel({
  steelAPIKey: steelKey,
  ...(steelLocal ? { baseURL: "http://localhost:3000" } : {}),
});
let sessionId: string | undefined;

async function ensureBrowser(): Promise<Page> {
  async function createNewSession() {
    if (browser) {
      await browser.close().catch(console.error);
    }
    try {
      const session = await steel.sessions.create({ timeout: 900000 });
      sessionId = session.id;
      console.error(
        JSON.stringify({
          message: "New session created with 15 minute timeout",
          sessionId,
        })
      );

      let browserWSEndpoint: string;
      if (steelLocal) {
        browserWSEndpoint = `ws://localhost:3000/`;
        console.error(JSON.stringify({ message: "Using local Steel instance" }));
      } else {
        browserWSEndpoint = `wss://connect.steel.dev?apiKey=${steelKey}&sessionId=${sessionId}`;
        console.error(JSON.stringify({ message: "Using remote Steel instance" }));
      }

      try {
        browser = await puppeteer.connect({ browserWSEndpoint });
        console.error(JSON.stringify({ message: "Successfully connected to browser" }));
      } catch (error) {
        console.error(JSON.stringify({
          message: "Failed to connect to browser",
          error: (error as Error).message,
          stack: (error as Error).stack
        }));
        throw error;
      }

      const pages = await browser.pages();
      page = pages[0];
      await page.setViewport({ width: 1280, height: 720 });
      setupPageListeners(page);
      return page;
    } catch (error) {
      console.error(JSON.stringify({
        message: "Failed to create session",
        error: (error as Error).message,
        stack: (error as Error).stack
      }));
      throw error;
    }
  }

  try {
    if (sessionId) {
      // If we have a sessionId, try to use the existing session
      try {
        const session = await steel.sessions.retrieve(sessionId);
        console.error(JSON.stringify({ message: "Retrieved existing session", status: session.status }));
        if (session.status === "live") {
          // Session is still valid, ensure we have a browser and page
          if (!browser || !page) {
            console.error(
              JSON.stringify({
                message: "Reconnecting to existing session",
                sessionId,
              })
            );
            let browserWSEndpoint: string;
            if (steelLocal) {
              browserWSEndpoint = `ws://localhost:3000/`;
            } else {
              browserWSEndpoint = `wss://connect.steel.dev?apiKey=${steelKey}&sessionId=${sessionId}`;
            }
            browser = await puppeteer.connect({ browserWSEndpoint });
            const pages = await browser.pages();
            page = pages[0];
            setupPageListeners(page);
          }
          // Test if the page is still usable
          await page.evaluate(() => true);
          return page;
        } else {
          console.error(
            JSON.stringify({
              message: "Existing session is not live. Creating a new one.",
              status: session.status
            })
          );
          return createNewSession();
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "Error retrieving session",
            error: (error as Error).message,
            stack: (error as Error).stack
          })
        );
        return createNewSession();
      }
    } else {
      // No existing session, create a new one
      console.error(
        JSON.stringify({ message: "No existing session. Creating a new one." })
      );
      return createNewSession();
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Error in ensureBrowser",
        error: (error as Error).message,
        stack: (error as Error).stack
      })
    );
    return createNewSession();
  }
}

function setupPageListeners(page: Page) {
  page.on("console", (msg) => {
    const logEntry = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(logEntry);
    server.notification({
      method: "notifications/resources/updated",
      params: { uri: "console://logs" },
    });
  });
}

async function handleToolCall(
  name: string,
  args: any
): Promise<CallToolResult> {
  console.error(
    JSON.stringify({ message: `Received tool call request for: ${name}` })
  );
  try {
    const page = await ensureBrowser();

    switch (name) {
      case "puppeteer_navigate":
        try {
          const timeout = args.timeout || 60000; // Default to 60 seconds
          const waitUntil = args.waitUntil || "domcontentloaded";

          // Start navigation
          const navigationPromise = page.goto(args.url, {
            timeout,
            waitUntil: waitUntil as
              | "load"
              | "domcontentloaded"
              | "networkidle0"
              | "networkidle2",
          });

          // Wait for navigation or timeout
          await Promise.race([
            navigationPromise,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Navigation timed out")),
                timeout
              )
            ),
          ]);

          // Check if the page has loaded enough to be interactive
          const isPageLoaded = await page.evaluate(() => {
            return (
              document.readyState === "interactive" ||
              document.readyState === "complete"
            );
          });

          if (!isPageLoaded) {
            throw new Error("Page did not reach interactive state");
          }

          // Get the final URL (in case of redirects)
          const finalUrl = page.url();

          return {
            content: [
              {
                type: "text",
                text: `Successfully navigated to ${finalUrl}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "Navigation error",
              error: (error as Error).message,
            })
          );
          // If navigation fails, try to get the current URL
          let currentUrl = args.url;
          try {
            currentUrl = await page.evaluate(() => window.location.href);
          } catch (evalError) {
            console.error("Error getting current URL:", evalError);
          }
          return {
            content: [
              {
                type: "text",
                text: `Navigation to ${args.url} failed or timed out. Current URL: ${currentUrl}. Error: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_screenshot": {
        try {
          const screenshot = (await page.screenshot({
            encoding: "base64",
          })) as string;

          screenshots.set(args.name, screenshot);
          server.notification({
            method: "notifications/resources/list_changed",
          });

          return {
            content: [
              {
                type: "text",
                text: `Screenshot '${args.name}' taken.`,
              } as TextContent,
              {
                type: "image",
                data: screenshot,
                mimeType: "image/png",
              } as ImageContent,
            ],
            isError: false,
          };
        } catch (error) {
          console.error("Screenshot error:", error);
          return {
            content: [
              {
                type: "text",
                text: `Failed to take screenshot: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "puppeteer_click":
        try {
          const selector = args.selector;
          const timeout = args.timeout || 5000; // Default timeout of 5 seconds, can be overridden

          // First, check if the element already exists
          const element = await page.$(selector);

          if (element) {
            // If the element exists, click it immediately
            await element.click();
          } else {
            // If not, wait for it with the specified timeout
            await page.waitForSelector(selector, { timeout });
            await page.click(selector);
          }

          return {
            content: [
              {
                type: "text",
                text: `Clicked element ${selector}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to click ${args.selector}: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_fill":
        try {
          await page.waitForSelector(args.selector);
          await page.type(args.selector, args.value);
          return {
            content: [
              {
                type: "text",
                text: `Filled ${args.selector} with: ${args.value}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to fill ${args.selector}: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_select":
        try {
          await page.waitForSelector(args.selector);
          await page.select(args.selector, args.value);
          return {
            content: [
              {
                type: "text",
                text: `Selected ${args.selector} with: ${args.value}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to select ${args.selector}: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_hover":
        try {
          await page.waitForSelector(args.selector);
          await page.hover(args.selector);
          return {
            content: [
              {
                type: "text",
                text: `Hovered ${args.selector}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to hover ${args.selector}: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_evaluate":
        try {
          const result = await page.evaluate((script) => {
            const logs: string[] = [];
            const originalConsole = { ...console };

            ["log", "info", "warn", "error"].forEach((method) => {
              (console as any)[method] = (...args: any[]) => {
                logs.push(`[${method}] ${args.join(" ")}`);
                (originalConsole as any)[method](...args);
              };
            });

            try {
              const result = eval(script);
              Object.assign(console, originalConsole);
              return { result, logs };
            } catch (error) {
              Object.assign(console, originalConsole);
              throw error;
            }
          }, args.script);

          return {
            content: [
              {
                type: "text",
                text: `Execution result:\n${JSON.stringify(result.result, null, 2)}\n\nConsole output:\n${result.logs.join("\n")}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Script execution failed: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_scroll":
        try {
          const scrollDelay = args.scrollDelay || 100;
          const maxScrolls = args.maxScrolls || 50;
          await page.evaluate(
            async (delay, max) => {
              await new Promise<void>((resolve) => {
                let scrolls = 0;
                const timer = setInterval(() => {
                  window.scrollBy(0, window.innerHeight);
                  scrolls++;
                  if (
                    scrolls >= max ||
                    window.innerHeight + window.scrollY >=
                      document.body.offsetHeight
                  ) {
                    clearInterval(timer);
                    resolve();
                  }
                }, delay);
              });
            },
            scrollDelay,
            maxScrolls
          );
          return {
            content: [
              {
                type: "text",
                text: `Scrolled the page to trigger lazy-loading`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to scroll the page: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }

      case "puppeteer_get_content":
        try {
          const maxTokens = 150000; // Limit for Claude 3.5 Sonnet's 200k context
          const enc = encoding_for_model("gpt-3.5-turbo");

          let content;
          if (args.selector) {
            content = await page.evaluate((selector) => {
              const elements = document.querySelectorAll(selector);
              return Array.from(elements).map((el) => el.outerHTML).join(" ");
            }, args.selector);
          } else {
            content = await page.evaluate(() => document.documentElement.outerHTML);
          }

          // Sanitize the content while preserving important structure
          const sanitizeContent = (html: string) => {
            return html
              .replace(/>\s+</g, "><") // Remove whitespace between tags
              .replace(/(\s{2,}|\n)/g, " ") // Replace multiple spaces or newlines with a single space
              .replace(/\s+/g, " ") // Replace remaining whitespace sequences with a single space
              .trim(); // Remove leading and trailing whitespace
          };

          const sanitizedContent = sanitizeContent(content);

          // Tokenize the content
          const tokens = enc.encode(sanitizedContent);

          // Truncate the tokens if they exceed the max limit
          let truncatedContent;
          if (tokens.length > maxTokens) {
            const truncatedTokens = tokens.slice(0, maxTokens);
            truncatedContent = enc.decode(truncatedTokens) + "... (truncated)";
          } else {
            truncatedContent = sanitizedContent;
          }

          // Free the encoder to prevent memory leaks
          enc.free();

          console.error(JSON.stringify({
            message: "Content extracted and truncated",
            originalLength: content.length,
            sanitizedLength: sanitizedContent.length,
            tokenCount: tokens.length,
            truncatedLength: truncatedContent.length
          }));

          return {
            content: [
              {
                type: "text",
                text: `Extracted content: ${truncatedContent}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error(JSON.stringify({
            message: "Failed to extract content",
            error: (error as Error).message,
            stack: (error as Error).stack
          }));
          return {
            content: [
              {
                type: "text",
                text: `Failed to extract content: ${(error as Error).message}`,
              },
            ],
            isError: true,
          };
        }

      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Error in handleToolCall",
        error: (error as Error).message,
      })
    );
    return {
      content: [
        {
          type: "text",
          text: `An error occurred: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  } finally {
    console.error(
      JSON.stringify({ message: `Completed tool call for: ${name}` })
    );
  }
}

const server = new Server(
  {
    name: "steel-puppeteer",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Setup request handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "console://logs",
      mimeType: "text/plain",
      name: "Browser console logs",
    },
    ...Array.from(screenshots.keys()).map((name) => ({
      uri: `screenshot://${name}`,
      mimeType: "image/png",
      name: `Screenshot: ${name}`,
    })),
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri.toString();

  if (uri === "console://logs") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: consoleLogs.join("\n"),
        },
      ],
    };
  }

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

async function runServer() {
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
  } catch (error) {
    console.error("Server connection error:", error);
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error("Unhandled error in server:", error);
  process.exit(1);
});
