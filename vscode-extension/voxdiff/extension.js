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

function activate(context) {
  console.log("VoxDiff extension activated");

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (!event.selections[0].isEmpty) {
        lastEditor = event.textEditor;
        lastSelectionRange = event.selections[0];
        lastSelectionText = event.textEditor.document.getText(event.selections[0]);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("voxdiff.openPanel", () => {
      const panel = vscode.window.createWebviewPanel(
        "voxdiffChat",
        "VoxDiff",
        vscode.ViewColumn.One,
        { 
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      currentPanel = panel;
      panel.webview.html = getWebviewContent();

      panel.webview.onDidReceiveMessage(async message => {
        if (message.type === "startRecording") startRecording(panel);
        if (message.type === "stopRecording") stopRecording(panel);
        if (message.type === "undo") {
          await vscode.commands.executeCommand("undo");
          send(panel, "Undo completed");
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

function startRecording(panel) {
  try {
    if (currentRecorder) {
      stopRecording(panel);
      return;
    }

    const tmpFile = path.join("/tmp", "voxdiff_" + Date.now() + ".wav");
    const recCommand = "rec";
    const recArgs = [tmpFile, "silence", "1", "0.1", "2%", "1", "2.5", "2%"];

    currentRecorder = spawn(recCommand, recArgs);

    currentRecorder.on("error", err => {
      console.error("Recording error:", err);
      if (err.code === "ENOENT") {
        startRecordingWithAFRecord(panel, tmpFile);
        return;
      }
      send(panel, "Recording error: " + err.message);
      currentRecorder = null;
    });

    currentRecorder.on("close", async () => {
      console.log("Recording ended");
      currentRecorder = null;

      if (!fs.existsSync(tmpFile)) {
        send(panel, "No audio recorded");
        return;
      }

      const buffer = fs.readFileSync(tmpFile);
      const base64 = buffer.toString("base64");

      fs.unlink(tmpFile, err => {
        if (err) console.error("Cleanup error:", err);
      });

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
      "-f", "WAVE", "-b", "16", "-c", "1", "-r", "16000", "-t", "10", tmpFile
    ]);

    currentRecorder.on("error", err => {
      console.error("AFRecord error:", err);
      send(panel, "Microphone error: afrecord not available");
      currentRecorder = null;
    });

    currentRecorder.on("close", async () => {
      console.log("Recording ended");
      currentRecorder = null;

      if (!fs.existsSync(tmpFile)) {
        send(panel, "No audio recorded");
        return;
      }

      const buffer = fs.readFileSync(tmpFile);
      const base64 = buffer.toString("base64");

      fs.unlink(tmpFile, err => {
        if (err) console.error("Cleanup error:", err);
      });

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

async function handleVoice(audioBase64, panel) {
  try {
    if (!lastEditor || !lastSelectionText) {
      send(panel, "Please select code in the editor first.");
      return;
    }

    send(panel, "Processing audio...");

    const sttRes = await fetch("http://127.0.0.1:8000/stt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64 })
    }).then(r => r.json());

    send(panel, "Heard: " + sttRes.text);

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
  lastModifiedCode = data.modified_code || null;

  if (lastModifiedCode) {
    applyModifiedCode();
  }

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
    if (!audioBase64 || audioBase64.length === 0) return;

    const audioPath = path.join("/tmp", "voxdiff_audio_" + Date.now() + ".mp3");
    const buffer = Buffer.from(audioBase64, "base64");
    
    fs.writeFileSync(audioPath, buffer);

    const player = spawn("afplay", [audioPath]);

    player.on("error", err => {
      console.error("Audio player error:", err);
      setTimeout(() => {
        try { fs.unlinkSync(audioPath); } catch(e) {}
      }, 100);
    });

    player.on("close", () => {
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

function getWebviewContent() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #ffffff;
      color: #202124;
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding: 24px;
      gap: 16px;
    }

    h1 {
      font-size: 20px;
      font-weight: 500;
      color: #202124;
      letter-spacing: -0.5px;
    }

    #status {
      font-size: 12px;
      color: #5f6368;
      height: 16px;
      line-height: 16px;
    }

    #status.listening {
      color: #1f73c7;
      font-weight: 500;
    }

    #status.processing {
      color: #d33b27;
      font-weight: 500;
    }

    #chat {
      flex: 1;
      overflow-y: auto;
      border: 1px solid #dadce0;
      border-radius: 8px;
      padding: 16px;
      background: #fafafa;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    #chat::-webkit-scrollbar {
      width: 8px;
    }

    #chat::-webkit-scrollbar-track {
      background: transparent;
    }

    #chat::-webkit-scrollbar-thumb {
      background: #ccc;
      border-radius: 4px;
    }

    #chat::-webkit-scrollbar-thumb:hover {
      background: #999;
    }

    .msg {
      padding: 12px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
      background: white;
      border-left: 3px solid #dadce0;
      color: #202124;
    }

    .msg.assistant {
      border-left-color: #1f73c7;
      background: #e8f0fe;
    }

    #controls {
      display: flex;
      gap: 8px;
    }

    button {
      padding: 8px 16px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      background: white;
      color: #3c4043;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      flex: 1;
      font-family: inherit;
    }

    button:hover:not(:disabled) {
      background: #f8f9fa;
      border-color: #c6c6c6;
    }

    button:active:not(:disabled) {
      background: #f1f3f4;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #startBtn.recording {
      background: #1f73c7;
      color: white;
      border-color: #1f73c7;
    }

    #startBtn.recording:hover {
      background: #1563b0;
      border-color: #1563b0;
    }
  </style>
</head>
<body>

  <h1>VoxDiff</h1>
  <div id="status"></div>
  <div id="chat"></div>
  <div id="controls">
    <button id="startBtn">Start Recording</button>
    <button id="undoBtn">Undo</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById("chat");
    const startBtn = document.getElementById("startBtn");
    const undoBtn = document.getElementById("undoBtn");
    const status = document.getElementById("status");

    let isRecording = false;

    function setStatus(text, className) {
      status.textContent = text;
      status.className = className;
    }

    function addMessage(text, isAssistant) {
      const msg = document.createElement("div");
      msg.className = "msg" + (isAssistant ? " assistant" : "");
      msg.textContent = text;
      chat.appendChild(msg);
      chat.scrollTop = chat.scrollHeight;
    }

    function toggleRecording() {
      if (!isRecording) {
        isRecording = true;
        startBtn.textContent = "Stop Recording";
        startBtn.classList.add("recording");
        setStatus("Listening...", "listening");
        vscode.postMessage({ type: "startRecording" });
      } else {
        isRecording = false;
        startBtn.textContent = "Start Recording";
        startBtn.classList.remove("recording");
        setStatus("Processing...", "processing");
        vscode.postMessage({ type: "stopRecording" });
      }
    }

    startBtn.addEventListener("click", toggleRecording);
    undoBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "undo" });
    });

    window.addEventListener("message", event => {
      const msg = event.data;

      if (msg.type === "assistantMessage") {
        addMessage(msg.text, true);
        setStatus("Ready", "");
        isRecording = false;
        startBtn.textContent = "Start Recording";
        startBtn.classList.remove("recording");

        if (msg.audioBase64 && msg.audioBase64.length > 0) {
          vscode.postMessage({
            type: "playAudio",
            audioBase64: msg.audioBase64
          });
        }
      }

      if (msg.type === "recordingStarted") {
        setStatus("Listening...", "listening");
      }

      if (msg.type === "recordingStopped") {
        setStatus("Processing...", "processing");
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { activate, deactivate };
