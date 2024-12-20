# Steel Voyager

![Steel Voyager Demo](assets/mcp-figma-application-demo.mp4)
"
A powerful Model Context Protocol (MCP) server that enables LLMs like Claude to automate web browsers through Puppeteer and Steel. It provides capabilities for browser automation, taking screenshots, and executing JavaScript in a real browser environment.
Ask Claude to help you with tasks like:

- "Navigate to a website and fill out a complex form"
- "Log into my account and check my order status"
- "Research products across multiple e-commerce sites"
- "Automate repetitive web tasks like data entry or form submissions"

## 🚀 Quick Start

Below are the basic steps for getting started with Steel Voyager. This includes how to set up for both cloud and local/self-hosted modes, as well as how to configure Claude Desktop.

### 1. Clone and Install

```bash
git clone https://github.com/steel-voyager/steel-voyager.git
cd steel-voyager
npm install
npm run build
```

### 2. Choose Your Deployment Mode

Steel Voyager supports two main modes: **Cloud** and **Local/Self-Hosted**.

#### A) Cloud Mode

1. Obtain your Steel API key.
2. Configure the following environment variables:
   ```
   STEEL_LOCAL=false
   STEEL_API_KEY=YOUR_STEEL_API_KEY_HERE
   STEEL_BASE_URL=https://api.steel.dev  # or your custom endpoint if self-hosted
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. (Optional) If you use Claude Desktop, update your claude_desktop_config.json to point to your built server and make sure to include the environment variables. For example:

   ```json
   {
     "mcpServers": {
       "steel-puppeteer": {
         "command": "node",
         "args": ["path/to/steel-voyager/dist/index.js"],
         "env": {
           "STEEL_LOCAL": "false",
           "STEEL_API_KEY": "YOUR_STEEL_API_KEY_HERE",
           "GLOBAL_WAIT_SECONDS": "1"
         }
       }
     }
   }
   ```

5. Launch Claude Desktop, and it will start Steel Voyager in cloud mode using the provided configuration.

#### B) Local / Self-Hosted Mode

1. Make sure you have the open-source Steel Docker image running locally (or on your custom server).  
   ↪ You can learn more about the open-source [Steel Docker image here](https://github.com/example/steel-docker#readme).
2. Set the following environment variables:
   ```
   STEEL_LOCAL=true
   STEEL_BASE_URL=http://localhost:3000  # or your custom domain/host if overriding
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. (Optional) Configure Claude Desktop in a similar way as cloud mode, but with the local environment variables:

   ```json
   {
     "mcpServers": {
       "steel-puppeteer": {
         "command": "node",
         "args": ["path/to/steel-voyager/dist/index.js"],
         "env": {
           "STEEL_LOCAL": "true",
           "STEEL_BASE_URL": "http://localhost:3000",
           "GLOBAL_WAIT_SECONDS": "1"
         }
       }
     }
   }
   ```

5. Launch Claude Desktop, which will automatically start Steel Voyager and connect to your locally running Steel service.

## Components

### Tools

- **navigate**

  - Navigate to any URL in the browser
  - Inputs:
    - `url` (string, required): URL to navigate to (e.g. "https://example.com").

- **search**

  - Perform a Google search by navigating to "https://www.google.com/search?q=encodedQuery".
  - Inputs:
    - `query` (string, required): Text to search for on Google.

- **click**

  - Click elements on the page using numbered labels
  - Inputs:
    - `label` (number, required): The label number of the element to click.

- **type**

  - Type text into input fields using numbered labels
  - Inputs:
    - `label` (number, required): The label number of the input field.
    - `text` (string, required): Text to type into the field.
    - `replaceText` (boolean, optional): If true, replaces any existing text in the field.

- **scroll_down**

  - Scroll down the page
  - Inputs:
    - `pixels` (integer, optional): Number of pixels to scroll down. If not specified, scrolls by one full page.

- **scroll_up**

  - Scroll up the page
  - Inputs:
    - `pixels` (integer, optional): Number of pixels to scroll up. If not specified, scrolls by one full page.

- **go_back**

  - Navigate to the previous page in browser history
  - No inputs required

- **wait**

  - Wait for up to 10 seconds, useful for pages that load slowly or need more time for dynamic content to appear.
  - Inputs:
    - `seconds` (number, required): Number of seconds to wait (0 to 10).

- **save_unmarked_screenshot**
  - Capture the current page without bounding boxes or highlights and store it as a resource.
  - Inputs:
    - `resourceName` (string, optional): Name to store the screenshot under (e.g. "before_login"). If omitted, a generic name is generated automatically.

### Resources

- **Screenshots**:
  Each saved screenshot is accessible via an MCP resource URI in the form of:
  • `screenshot://RESOURCE_NAME`

  The server stores these screenshots whenever you specify the "save_unmarked_screenshot" tool or when an action concludes (for most tools) with an annotated screenshot. These images can be retrieved through a standard MCP resource retrieval request.

(Note: While console logs are still collected for analysis and debugging, they are not exposed as retrievable resources in this implementation. They appear in the server’s logs but are not served via MCP resource URIs.)

## Key Features

- Browser automation with Puppeteer
- Steel integration for browser session management
- Visual element identification through numbered labels
- Console log monitoring and capture
- Screenshot capabilities
- JavaScript execution
- Basic web interaction (navigation, clicking, form filling)
- Content extraction with token limit handling
- Lazy-loading support through scrolling
- Local and remote Steel instance support

## Understanding Bounding Boxes

When interacting with pages, Steel Puppeteer adds visual overlays to help identify interactive elements:

- Each interactive element (buttons, links, inputs) gets a unique numbered label
- Colored boxes outline the elements' boundaries
- Labels appear above or inside elements for easy reference
- Use these numbers when specifying elements for click or type operations

Below is a revised “Configuration” section for your README, aiming for greater clarity and simplicity.

## Configuration

Steel Voyager can run in two modes: "Local" or "Cloud". This behavior is controlled by environment variables. Below is a concise overview:

| Environment Variable | Default                 | Description                                                                                                                                                                                                                    |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| STEEL_LOCAL          | "false"                 | Determines if Steel Voyager runs in local (true) or cloud (false) mode.                                                                                                                                                        |
| STEEL_API_KEY        | (none)                  | Required only when STEEL_LOCAL = "false". Used to authenticate requests with the Steel endpoint.                                                                                                                               |
| STEEL_BASE_URL       | "https://api.steel.dev" | The base URL for the Steel API. Override this if self-hosting the Steel server (either locally or in your own cloud environment). If STEEL_LOCAL = "true" and STEEL_BASE_URL is unset, it defaults to "http://localhost:3000". |
| GLOBAL_WAIT_SECONDS  | (none)                  | Optional. Number of seconds to wait after each tool action (for instance, to allow slow-loading pages).                                                                                                                        |

### Local Mode

1. Set STEEL_LOCAL="true".
2. (Optional) Set STEEL_BASE_URL to point to the Steel server if you host it on a custom domain. Otherwise, Steel Voyager will default to http://localhost:3000.
3. No API key is required in this mode.
4. Puppeteer will connect via ws://0.0.0.0:3000/?sessionId=…

Example:

export STEEL_LOCAL="true"
export STEEL_BASE_URL="http://localhost:3000" # only if overriding

### Cloud Mode

1. Set STEEL_LOCAL="false".
2. Set STEEL_API_KEY so Steel Voyager can authenticate with the Steel cloud service (or your self-hosted Steel if you changed STEEL_BASE_URL).
3. STEEL_BASE_URL defaults to https://api.steel.dev; override this if you have a self-hosted Steel instance running on another endpoint.
4. Puppeteer will connect via wss://connect.steel.dev?sessionId=…&apiKey=…

Example:

export STEEL_LOCAL="false"
export STEEL_API_KEY="YOUR_STEEL_API_KEY_HERE"
export STEEL_BASE_URL="https://my-self-hosted-steel.example.com" # optional

### Claude Desktop Configuration

To use Steel Voyager with Claude Desktop, add something like this to your config file (often located at
~/Library/Application Support/Claude/claude_desktop_config.json):

```json
{
  "mcpServers": {
    "steel-puppeteer": {
      "command": "node",
      "args": ["path/to/steel-puppeteer/dist/index.js"],
      "env": {
        "STEEL_LOCAL": "false",
        "STEEL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Adjust the environment variables to match your desired mode:

• If running locally/self hosted, keep `"STEEL_LOCAL": "true"` and optionally `"STEEL_BASE_URL": "http://localhost:3000"`.  
• If running in cloud mode, remove `"STEEL_LOCAL": "true"`, add `"STEEL_LOCAL": "false"`, and supply `"STEEL_API_KEY": "<YourKey>"`
This will allow Claude Desktop to start Steel Voyager in the correct mode.

## Installation & Running

### Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Start the server:
   ```bash
   npm start
   ```

### Cloud Deployment

1. Set up your Steel API key
2. Configure environment variables
3. Deploy using your preferred hosting solution
4. Connect Claude Desktop to your deployed instance

## Example Usage

You can ask Claude to perform various web automation tasks:

- "Navigate to example.com and click the login button"
- "Fill out the contact form on the page"
- "Scroll through the product listings and capture screenshots"
- "Log into my account using the credentials in my password manager"

## Troubleshooting

Common issues and solutions:

1. **Connection Problems**

   - Verify Steel API key if using cloud service
   - Check if local Steel instance is running
   - Confirm network connectivity

2. **Element Interaction Issues**

   - Ensure elements are visible in viewport
   - Check if labels are correctly assigned
   - Verify element is interactive

3. **Screenshot Problems**
   - Check page load completion
   - Verify viewport size settings
   - Ensure sufficient memory available

## Contributing

This project is experimental and under active development. Contributions are welcome!

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

Please include:

- Clear description of changes
- Motivation
- Documentation updates

## Disclaimer

⚠️ This project is experimental and based on the Web Voyager codebase. Use in production environments at your own risk.
