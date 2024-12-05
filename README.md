# Steel Puppeteer

A Model Context Protocol server that provides browser automation capabilities using Puppeteer and Steel. This server enables LLMs to interact with web pages, take screenshots, and execute JavaScript in a real browser environment.

## Components

### Tools

- **puppeteer_navigate**
  - Navigate to any URL in the browser
  - Inputs:
    - `url` (string, required): URL to navigate to
    - `timeout` (number, optional, default: 60000): Navigation timeout in milliseconds
    - `waitUntil` (string, optional, default: "domcontentloaded"): When to consider navigation succeeded. Options: "load", "domcontentloaded", "networkidle0", "networkidle2"

- **puppeteer_screenshot**
  - Capture screenshots of the entire page or specific elements
  - Inputs:
    - `name` (string, required): Name for the screenshot
    - `selector` (string, optional): CSS selector for element to screenshot

- **puppeteer_click**
  - Click elements on the page
  - Input: `selector` (string, required): CSS selector for element to click

- **puppeteer_fill**
  - Fill out input fields
  - Inputs:
    - `selector` (string, required): CSS selector for input field
    - `value` (string, required): Value to fill

- **puppeteer_select**
  - Select an element with SELECT tag
  - Inputs:
    - `selector` (string, required): CSS selector for element to select
    - `value` (string, required): Value to select

- **puppeteer_hover**
  - Hover elements on the page
  - Input: `selector` (string, required): CSS selector for element to hover

- **puppeteer_evaluate**
  - Execute JavaScript in the browser console
  - Input: `script` (string, required): JavaScript code to execute

- **puppeteer_get_content**
  - Extract content from the current page
  - Input: `selector` (string, optional): CSS selector to get content from specific elements. If not provided, returns whole page content

- **puppeteer_scroll**
  - Scroll the page to trigger lazy-loading
  - Inputs:
    - `scrollDelay` (number, optional, default: 100): Delay between scrolls in milliseconds
    - `maxScrolls` (number, optional, default: 50): Maximum number of scrolls

### Resources

The server provides access to two types of resources:

1. **Console Logs** (`console://logs`)
   - Browser console output in text format
   - Includes all console messages from the browser

2. **Screenshots** (`screenshot://<name>`)
   - PNG images of captured screenshots
   - Accessible via the screenshot name specified during capture

## Key Features

- Browser automation with Puppeteer
- Steel integration for browser session management
- Console log monitoring and capture
- Screenshot capabilities
- JavaScript execution
- Basic web interaction (navigation, clicking, form filling)
- Content extraction with token limit handling
- Lazy-loading support through scrolling
- Local and remote Steel instance support

## Configuration

### Claude Desktop Configuration

To use the Steel Puppeteer server with Claude Desktop, add the following configuration to your Claude Desktop config file (typically located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "steel-puppeteer": {
      "command": "node",
      "args": ["path/to/steel-puppeteer/dist/index.js"],
      "env": {
        "STEEL_LOCAL": "true"
      }
    }
  }
}
```

Replace `"path/to/steel-puppeteer/dist/index.js"` with the actual path to the compiled JavaScript file on your system.

### Environment Variables

The Steel Puppeteer server can be configured using the following environment variables:

- `STEEL_LOCAL` (optional, default: "false"): Set to "true" to use a local Steel instance instead of the cloud service.
- `STEEL_API_KEY` (required only if `STEEL_LOCAL` is "false"): Your Steel API key for authentication when using the cloud service.
- `STEEL_URL` (optional): The URL of your Steel instance if using a custom deployment.


### Server Configuration
If you're running the Steel Puppeteer server directly (not through Claude Desktop), you can set these environment variables in your shell or create a `.env` file in the project root. Here's an example `.env` file for local usage:

```
STEEL_LOCAL=true
```

If you're using the Steel cloud service, your `.env` file would look like this:

```
STEEL_API_KEY=your-steel-api-key
STEEL_LOCAL=false
```

### Running the Server

To start the Steel Puppeteer server:

1. Install dependencies:
   ```
   npm install
   ```

2. Build the project:
   ```
   npm run build
   ```

3. Start the server:
   ```
   npm start
   ```

4. Open Claude Desktop and browse away!
The server will start and listen on the specified port (default: 3000).

### Troubleshooting

- If you encounter issues with Puppeteer, ensure that you have the necessary dependencies installed on your system. Refer to the [Puppeteer troubleshooting guide](https://pptr.dev/#?product=Puppeteer&version=v13.5.0&show=api-troubleshooting) for more information.
- If using the Steel cloud service, make sure your Steel API key is valid and has the necessary permissions.
- If using a local Steel instance, ensure it's running and accessible at the specified URL (if custom) or at the default local address.

For more detailed configuration options and advanced usage, refer to the Steel documentation and the Puppeteer API reference.
