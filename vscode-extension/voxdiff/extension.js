const vscode = require("vscode");

let lastSelectionText = "";
let lastEditor = null;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log("VoxDiff extension activated");

  // Track selection changes
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (!event.selections[0].isEmpty) {
        lastEditor = event.textEditor;
        lastSelectionText = event.textEditor.document.getText(
          event.selections[0]
        );
      }
    })
  );

  const command = vscode.commands.registerCommand(
    "voxdiff.openPanel",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "voxdiffChat",
        "VoxDiff Assistant",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = getWebviewContent();

      panel.webview.onDidReceiveMessage(
        async message => {
          if (message.type === "userMessage") {
            console.log("User message:", message.text);
            console.log("Selected code:", lastSelectionText);

            if (!lastSelectionText) {
              panel.webview.postMessage({
                type: "assistantMessage",
                text: "Please select some code in the editor so I can help you."
              });
              return;
            }

            // TODO: call backend here
            panel.webview.postMessage({
              type: "assistantMessage",
              text: "I received your code and will process it next."
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
<html>
<body>
  <h2>VoxDiff</h2>
  <div id="chat"></div>
  <input id="input" placeholder="Type a message..." />
  <button onclick="send()">Send</button>

  <script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById("chat");

    function send() {
      const input = document.getElementById("input");
      vscode.postMessage({
        type: "userMessage",
        text: input.value
      });
      input.value = "";
    }

    window.addEventListener("message", e => {
      chat.innerHTML += "<div>" + e.data.text + "</div>";
    });
  </script>
</body>
</html>
`;
}

module.exports = { activate, deactivate };
