const vscode = require("vscode");
const fetch = require("node-fetch");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

let lastEditor = null;
let lastSelectionRange = null;
let lastSelectionText = "";
let lastModifiedCode = null;
let currentRecorder = null;
let currentPanel = null;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log("VoxDiff extension activated");

  // Track selection
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (!event.selections[0].isEmpty) {
        lastEditor = event.textEditor;
        lastSelectionRange = event.selections[0];
        lastSelectionText =
          event.textEditor.document.getText(event.selections[0]);
      }
    })
  );

  // Open panel command
  context.subscriptions.push(
    vscode.commands.registerCommand("voxdiff.openPanel", () => {
      const panel = vscode.window.createWebviewPanel(
        "voxdiffChat",
        "VoxDiff Assistant",
        vscode.ViewColumn.One,
        { 
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      currentPanel = panel;
      panel.webview.html = getWebviewContent();

      panel.webview.onDidReceiveMessage(async message => {
        if (message.type === "startRecording") {
          startRecording(panel);
        }

        if (message.type === "stopRecording") {
          stopRecording(panel);
        }

        if (message.type === "undo") {
          await vscode.commands.executeCommand("undo");
          send(panel, "Undo successful");
        }

        if (message.type === "playAudio" && message.audioBase64) {
          playAudioFile(message.audioBase64);
        }
      });

      panel.onDidDispose(() => {
        if (currentRecorder) {
          currentRecorder.stop();
          currentRecorder = null;
        }
        currentPanel = null;
      });
    })
  );
}

// ==================
// RECORDING
// ==================

function startRecording(panel) {
  try {
    if (currentRecorder) {
      stopRecording(panel);
      return;
    }

    const tmpFile = path.join("/tmp", "voxdiff_" + Date.now() + ".wav");
    
    // Try 'rec' first (from SoX), fall back to 'afrecord' (native macOS)
    const recCommand = "rec";
    const recArgs = [
      tmpFile,
      "silence", "1", "0.1", "2%", "1", "2.5", "2%"
    ];

    currentRecorder = spawn(recCommand, recArgs);

    let hasStarted = false;

    currentRecorder.on("error", err => {
      console.error("Recording error:", err);
      
      // If 'rec' fails, try native afrecord
      if (!hasStarted && err.code === "ENOENT") {
        console.log("rec not found, trying afrecord...");
        startRecordingWithAFRecord(panel, tmpFile);
        return;
      }
      
      send(panel, "Recording error: " + err.message);
      currentRecorder = null;
    });

    currentRecorder.on("close", async (code) => {
      hasStarted = true;
      console.log("Recording ended with code:", code);
      currentRecorder = null;

      if (!fs.existsSync(tmpFile)) {
        send(panel, "No audio recorded");
        return;
      }

      // Read file and convert to base64
      const buffer = fs.readFileSync(tmpFile);
      const base64 = buffer.toString("base64");

      // Clean up
      fs.unlink(tmpFile, (err) => {
        if (err) console.error("Cleanup error:", err);
      });

      // Send to backend
      await handleVoice(base64, panel);
    });

    send(panel, "Listening...");
    panel.webview.postMessage({ type: "recordingStarted" });
  } catch (err) {
    console.error("Start recording error:", err);
    send(panel, "Microphone error: " + err.message);
  }
}

function startRecordingWithAFRecord(panel, tmpFile) {
  try {
    currentRecorder = spawn("afrecord", [
      "-f", "WAVE",
      "-b", "16",
      "-c", "1",
      "-r", "16000",
      "-t", "10",
      tmpFile
    ]);

    let hasStarted = false;

    currentRecorder.on("error", err => {
      console.error("AFRecord error:", err);
      send(panel, "Microphone error: afrecord not available");
      currentRecorder = null;
    });

    currentRecorder.on("close", async (code) => {
      hasStarted = true;
      console.log("AFRecord ended with code:", code);
      currentRecorder = null;

      if (!fs.existsSync(tmpFile)) {
        send(panel, "No audio recorded");
        return;
      }

      // Read file and convert to base64
      const buffer = fs.readFileSync(tmpFile);
      const base64 = buffer.toString("base64");

      // Clean up
      fs.unlink(tmpFile, (err) => {
        if (err) console.error("Cleanup error:", err);
      });

      // Send to backend
      await handleVoice(base64, panel);
    });

    send(panel, "Listening...");
    panel.webview.postMessage({ type: "recordingStarted" });
  } catch (err) {
    console.error("AFRecord error:", err);
    send(panel, "Microphone error: " + err.message);
  }
}

function stopRecording(panel) {
  if (currentRecorder) {
    currentRecorder.kill();
    currentRecorder = null;
    panel.webview.postMessage({ type: "recordingStopped" });
  }
}

// ==================
// VOICE HANDLING
// ==================

async function handleVoice(audioBase64, panel) {
  try {
    if (!lastEditor || !lastSelectionText) {
      send(panel, "Please select code in the editor first.");
      return;
    }

    send(panel, "Processing audio...");

    // Speech to text
    const sttRes = await fetch("http://127.0.0.1:8000/stt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64 })
    }).then(r => r.json());

    send(panel, "Heard: " + sttRes.text);

    // Send to Gemini
    const data = await callChat(sttRes.text);
    handleChatResponse(data, panel);
  } catch (err) {
    console.error(err);
    send(panel, "Voice processing failed: " + err.message);
  }
}

async function callChat(text) {
  const res = await fetch("http://127.0.0.1:8000/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: text,
      selected_code: lastSelectionText,
      history: []
    })
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function handleChatResponse(data, panel) {
  // Store modified code
  lastModifiedCode = data.modified_code || null;

  // Auto-apply patch if code was modified
  if (lastModifiedCode) {
    applyModifiedCode();
  }

  // Send assistant message to webview
  panel.webview.postMessage({
    type: "assistantMessage",
    text: data.assistant_text,
    audioBase64: data.audio_base64,
    audioMime: data.audio_mime
  });
}

async function applyModifiedCode() {
  if (!lastEditor || !lastModifiedCode || !lastSelectionRange) {
    console.error("Cannot apply patch");
    return;
  }

  await vscode.window.showTextDocument(lastEditor.document);

  await lastEditor.edit(editBuilder => {
    editBuilder.replace(lastSelectionRange, lastModifiedCode);
  });

  lastModifiedCode = null;
}

function send(panel, text) {
  panel.webview.postMessage({
    type: "assistantMessage",
    text: text
  });
}

function playAudioFile(audioBase64) {
  try {
    if (!audioBase64 || audioBase64.length === 0) {
      console.log("No audio to play");
      return;
    }

    // Write audio to temp file
    const audioPath = path.join("/tmp", "voxdiff_audio_" + Date.now() + ".mp3");
    const buffer = Buffer.from(audioBase64, "base64");
    
    fs.writeFileSync(audioPath, buffer);
    console.log("Audio saved to:", audioPath);

    // Play audio using system command (afplay on macOS)
    const player = spawn("afplay", [audioPath]);

    player.on("error", (err) => {
      console.error("Audio player error:", err);
      // Clean up
      setTimeout(() => {
        try { fs.unlinkSync(audioPath); } catch(e) {}
      }, 100);
    });

    player.on("close", () => {
      console.log("Audio playback finished");
      // Clean up after playing
      setTimeout(() => {
        try { fs.unlinkSync(audioPath); } catch(e) {}
      }, 500);
    });
  } catch (err) {
    console.error("Audio playback error:", err);
  }
}

function deactivate() {
  if (currentRecorder) {
    currentRecorder.stop();
    currentRecorder = null;
  }
}

// ==================
// WEBVIEW UI
// ==================

function getWebviewContent() {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; 
      padding: 15px; 
      margin: 0;
      background: #f5f5f5;
    }
    h2 { margin-top: 0; color: #333; }
    #chat { 
      border: 1px solid #ddd; 
      height: 350px; 
      overflow-y: auto; 
      padding: 12px; 
      background: white;
      border-radius: 6px;
      margin-bottom: 15px;
    }
    .msg { 
      margin-bottom: 12px; 
      padding: 10px;
      background: #f0f0f0;
      border-radius: 4px;
      line-height: 1.4;
    }
    .msg.assistant {
      background: #e3f2fd;
      border-left: 3px solid #2196F3;
    }
    #controlPanel {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    button { 
      padding: 10px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    }
    button:hover:not(:disabled) {
      opacity: 0.9;
      transform: translateY(-1px);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    #startTalkBtn {
      background: #4CAF50;
      color: white;
      flex: 1;
      font-size: 14px;
    }
    #startTalkBtn.recording {
      background: #f44336;
      animation: pulse 1s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    #undoBtn {
      background: #999;
      color: white;
    }
    #status {
      font-size: 12px;
      color: #666;
      padding: 8px;
      text-align: center;
      min-height: 20px;
    }
    .status-listening {
      color: #4CAF50;
      font-weight: 500;
    }
    .status-processing {
      color: #ff9800;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <h2>VoxDiff - Voice First</h2>
  <div id="status"></div>
  <div id="chat"></div>

  <div id="controlPanel">
    <button id="startTalkBtn">Start Talking</button>
    <button id="undoBtn">Undo</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById("chat");
    const startBtn = document.getElementById("startTalkBtn");
    const undoBtn = document.getElementById("undoBtn");
    const statusDiv = document.getElementById("status");

    let isRecording = false;

    function updateStatus(text, className) {
      statusDiv.textContent = text;
      statusDiv.className = className || "";
    }

    function addMessage(text, isAssistant) {
      const div = document.createElement("div");
      div.className = "msg" + (isAssistant ? " assistant" : "");
      div.textContent = (isAssistant ? "Bot: " : "You: ") + text;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    function toggleRecording() {
      if (!isRecording) {
        isRecording = true;
        startBtn.textContent = "Stop Talking";
        startBtn.classList.add("recording");
        updateStatus("Listening...", "status-listening");
        vscode.postMessage({ type: "startRecording" });
      } else {
        isRecording = false;
        startBtn.textContent = "Start Talking";
        startBtn.classList.remove("recording");
        updateStatus("Processing...", "status-processing");
        vscode.postMessage({ type: "stopRecording" });
      }
    }

    startBtn.addEventListener("click", toggleRecording);

    undoBtn.addEventListener("click", function() {
      vscode.postMessage({ type: "undo" });
    });

    window.addEventListener("message", function(event) {
      const msg = event.data;

      if (msg.type === "assistantMessage") {
        addMessage(msg.text, true);
        updateStatus("Ready to listen", "");
        isRecording = false;
        startBtn.textContent = "Start Talking";
        startBtn.classList.remove("recording");

        // Play voice output if available - send to main extension thread
        if (msg.audioBase64 && msg.audioBase64.length > 0) {
          console.log("Requesting audio playback...");
          vscode.postMessage({
            type: "playAudio",
            audioBase64: msg.audioBase64
          });
        }
      }

      if (msg.type === "recordingStarted") {
        updateStatus("Listening...", "status-listening");
      }

      if (msg.type === "recordingStopped") {
        updateStatus("Processing...", "status-processing");
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { activate, deactivate };
