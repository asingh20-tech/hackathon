const vscode = require("vscode");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log("VoxDiff extension activated");

  const command = vscode.commands.registerCommand(
    "voxdiff.openPanel",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "voxdiffChat",
        "VoxDiff Assistant",
        vscode.ViewColumn.One,
        {
          enableScripts: true
        }
      );

      panel.webview.html = getWebviewContent();

      // Listen for messages from the webview
      panel.webview.onDidReceiveMessage(
        message => {
          if (message.type === "userMessage") {
            vscode.window.showInformationMessage(
              `User said: ${message.text}`
            );

            // Send a fake assistant reply for now
            panel.webview.postMessage({
              type: "assistantMessage",
              text: "I’m VoxDiff. I can see your message. Next, I’ll talk to the backend."
            });
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(command);
}

function deactivate() {}

function getWebviewContent() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 10px;
    }
    h2 {
      margin-top: 0;
    }
    #chat {
      border: 1px solid #ccc;
      height: 300px;
      overflow-y: auto;
      padding: 8px;
      margin-bottom: 8px;
    }
    .message {
      margin-bottom: 6px;
    }
    .user {
      font-weight: bold;
    }
    .assistant {
      color: #007acc;
    }
    #inputRow {
      display: flex;
    }
    input {
      flex: 1;
      padding: 6px;
    }
    button {
      margin-left: 6px;
      padding: 6px 10px;
    }
  </style>
</head>
<body>
  <h2>VoxDiff</h2>

  <div id="chat"></div>

  <div id="inputRow">
    <input id="input" type="text" placeholder="Type a message..." />
    <button onclick="sendMessage()">Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById("chat");
    const input = document.getElementById("input");

    function addMessage(text, className) {
      const div = document.createElement("div");
      div.className = "message " + className;
      div.textContent = text;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    function sendMessage() {
      const text = input.value;
      if (!text) return;

      addMessage("You: " + text, "user");

      vscode.postMessage({
        type: "userMessage",
        text: text
      });

      input.value = "";
    }

    window.addEventListener("message", event => {
      const message = event.data;

      if (message.type === "assistantMessage") {
        addMessage("VoxDiff: " + message.text, "assistant");
      }
    });
  </script>
</body>
</html>
`;
}

module.exports = {
  activate,
  deactivate
};
