<h1 align="center">
  Local Transfer
</h1>

<p align="center">
  A minimal local-only file sender &amp; receiver. Launch the program, open the browser, drag a file in — <b>any device on your LAN can send, and every device sees the same received-files list, live</b>. No encryption, no accounts, no setup. Just files.
</p>

<p align="center">
  <em>Inspired by <code>Local Encrypted Transfer</code> by <a href="https://github.com/loxy0devlp">loxy0devlp</a> — this variant drops the encryption layer for a frictionless plain-text local transfer, and is built with <b>Node.js + vanilla JS + CSS</b> (no Python, no build step).</em>
</p>

<p align="center">
  <img alt="made by" src="https://img.shields.io/badge/made%20by-camzzz-6ee7ff?style=flat-square">
  <img alt="version" src="https://img.shields.io/badge/version-1.0-b388ff?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-ff7ac6?style=flat-square">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D14-5ef5a8?style=flat-square">
</p>

---

<h2>✨ Features</h2>

<ul>
  <li>🌐 <b>Cross-device by default</b> — phone, tablet, laptop on the same Wi-Fi can all send and receive. The received-files list is <b>live</b>: poll every 3 s, new files appear with an animated highlight on every device.</li>
  <li>📤 <b>Send files</b> — drag &amp; drop or browse. Multi-file queue with progress bar at the top of the page.</li>
  <li>📥 <b>Receive files</b> — every uploaded file shows up in the list with size, date and a typed icon (img / vid / aud / zip / code / doc / file).</li>
  <li>🔎 <b>Filter &amp; refresh</b> — instant search through received files; manual refresh button for an immediate sync.</li>
  <li>🗑️ <b>One-click delete</b> — remove files from the server without leaving the page (syncs across all devices within 3 s).</li>
  <li>🎨 <b>Glassy animated UI</b> — backdrop-blur panels, animated aurora background, gradient borders, hover/press micro-animations, toast notifications.</li>
  <li>📱 <b>Responsive</b> — looks good on phone, tablet and desktop.</li>
  <li>⚡ <b>No encryption, no SSL</b> — plain HTTP for maximum simplicity on trusted local networks.</li>
  <li>🪶 <b>Tiny stack</b> — pure Node.js (<code>http</code> + <code>formidable</code>) on the server, vanilla JS + CSS on the client. No bundler, no framework.</li>
</ul>

<h2>🚀 Installation</h2>

<ol>
  <li>Clone the repository:</li>
  <pre>git clone https://github.com/cameleonnbss/Local-Transfer.git</pre>

  <li>Enter the project folder:</li>
  <pre>cd Local-Transfer</pre>

  <li>Install Node.js dependencies:</li>
  <pre>npm install</pre>

  <li>Run the server:</li>
  <pre>npm start</pre>
  <p><em>(or <code>node server.js</code> directly)</em></p>
</ol>

<h2>📋 Usage</h2>

<p>When you launch <code>server.js</code>, you'll see this banner in the terminal:</p>

<pre>
 _                    _                      _                 made by camzzz
| |    ___   ___ __ _| |  ___  ___ _ __   __| | ___ _ __       https://github.com/cameleonnbss
| |   / _ \ / __/ _` | | / __|/ _ \ '_ \ / _` |/ _ \ '__|
| |__| (_) | (_| (_| | | \__ \  __/ | | | (_| |  __/ |          no crypt  -  local host  -  lan ready
|_____\___/ \___\__,_|_| |___/\___|_| |_|\__,_|\___|_|          v1.0  (MIT License)

Access:
 * Local   : http://localhost:9999
 * Network : http://192.168.x.x:9999
</pre>

<p>Open the URL in any browser on the same network:</p>

<ul>
  <li><b>Send:</b> drag a file (or click) into the dropzone → press <em>Send</em>.</li>
  <li><b>Receive:</b> the file appears in the <em>Receive</em> panel on every device within 3 seconds → click <em>Get</em> to download.</li>
  <li><b>Delete:</b> click the trash icon next to any file.</li>
</ul>

<h2>⚙️ Configuration</h2>

<p>Edit <code>Config/Config.json</code>:</p>

<pre>
{
    "host": "0.0.0.0",
    "port": 9999
}
</pre>

<ul>
  <li><code>host</code> — <code>"0.0.0.0"</code> binds to all interfaces (LAN-accessible). Use <code>"127.0.0.1"</code> to restrict to localhost only.</li>
  <li><code>port</code> — any free TCP port. Default <code>9999</code>.</li>
</ul>

<h2>⚠️ Important</h2>

<ul>
  <li>This tool is <b>not encrypted</b>. Only use it on networks you trust (home, lab, offline LAN).</li>
  <li>Anyone with the URL can upload and download files. Don't expose the port to the public internet.</li>
  <li>Files are stored as-is in <code>Storage/</code>. Delete them from the UI or manually if needed.</li>
  <li>Uploads up to 8 GB are supported (streamed to disk via <code>formidable</code>).</li>
</ul>

<h2>📂 Project structure</h2>

<pre>
Local-Transfer/
├── server.js                # Node.js HTTP server (entry point)
├── package.json             # npm scripts + deps (formidable)
├── Config/
│   ├── Config.json          # host + port
│   └── Logs.json            # runtime file index (auto-managed)
├── Structure/
│   ├── Html.html            # page template (tokens injected by server)
│   ├── Css.css              # glassy animated styles
│   ├── Javascript.js        # upload / download / delete / live polling
│   └── Icone.ico            # favicon
├── Storage/                 # received files (auto-created)
├── Image/                   # screenshots
├── LICENSE
└── README.md
</pre>

<h2>🌐 How cross-device live updates work</h2>

<ol>
  <li>Any device uploads a file via <code>POST /</code> (multipart/form-data, streamed to <code>Storage/</code>).</li>
  <li>The server registers the file in <code>Config/Logs.json</code> and serves it from <code>Storage/</code>.</li>
  <li>Every open browser tab polls <code>GET /api/files</code> every 3 seconds.</li>
  <li>When the response changes, the JS re-renders the file list and highlights new entries with a glow animation.</li>
  <li>Downloads go through <code>GET /download/:name</code>; deletes through <code>POST /delete/:name</code> — both sync back to all devices on the next poll.</li>
</ol>

<h2>👨‍💻 Credits</h2>

<ul>
  <li>Made by: <b>camzzz</b></li>
  <li>GitHub: <a href="https://github.com/cameleonnbss">github.com/cameleonnbss</a></li>
  <li>Based on: <a href="https://github.com/loxy0devlp/Local-Encrypted-Transfer">Local Encrypted Transfer</a> by <b>loxy0devlp</b></li>
  <li>License: <b>MIT License</b></li>
  <li>Version: <b>v1.0</b></li>
</ul>
