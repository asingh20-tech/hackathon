const vscode = require("vscode");


let lastSelectionText = "";
let lastEditor = null;
let lastPatch = null;
let lastSelectionRange = null;


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
        lastSelectionRange = event.selections[0]; // 🔥 STORE RANGE
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

          // ---------------------------
          // USER MESSAGE → CALL BACKEND
          // ---------------------------
          if (message.type === "userMessage") {

            if (!lastSelectionText || !lastEditor) {
              panel.webview.postMessage({
                type: "assistantMessage",
                text: "Please select code in the editor first."
              });
              return;
            }

            try {
              const response = await fetch("http://127.0.0.1:8000/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  message: message.text,
                  selected_code: lastSelectionText,
                  history: []
                })
              });

              if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status}: ${text}`);
              }

              const data = await response.json();

              // Save patch for later
              lastPatch = data.proposed_patch || null;

              // Show assistant message
              panel.webview.postMessage({
                type: "assistantMessage",
                text: data.assistant_text,
                canApply: !!data.proposed_patch
              });

            } catch (err) {
              console.error("Backend error:", err);
              panel.webview.postMessage({
                type: "assistantMessage",
                text: "Backend error: " + err.message
              });
            }
          }

          // ---------------------------
          // APPLY PATCH (USER CLICK)
          // ---------------------------
          if (message.type === "applyPatch") {

            if (!lastEditor || !lastPatch || !lastSelectionRange) {
              panel.webview.postMessage({
                type: "assistantMessage",
                text: "Please select code and request a change first."
              });
              return;
            }

            await vscode.window.showTextDocument(lastEditor.document);

            await lastEditor.edit(editBuilder => {
              editBuilder.replace(
                lastSelectionRange,
                lastPatch.new_code
              );
            });

            panel.webview.postMessage({
              type: "assistantMessage",
              text: "Patch applied successfully ✅"
            });

            // cleanup
            lastPatch = null;
            lastSelectionRange = null;
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
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 10px;
    }
    #chat {
      border: 1px solid #ccc;
      height: 300px;
      overflow-y: auto;
      padding: 8px;
      margin-bottom: 8px;
    }
    .msg {
      margin-bottom: 10px;
    }
    .assistant {
      color: #007acc;
    }
    button {
      margin-top: 6px;
    }
  </style>
</head>
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

    window.addEventListener("message", event => {
      const div = document.createElement("div");
      div.className = "msg assistant";
      div.textContent = "VoxDiff: " + event.data.text;

      if (event.data.canApply) {
        const btn = document.createElement("button");
        btn.textContent = "Apply Patch";
        btn.onclick = () => {
          vscode.postMessage({ type: "applyPatch" });
        };
        div.appendChild(document.createElement("br"));
        div.appendChild(btn);
      }

      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
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
