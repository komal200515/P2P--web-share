# P2P Web Share — Direct Browser-to-Browser File Transfer

## Overview

P2P Web Share is a lightweight peer-to-peer file sharing application built using React.js, WebRTC, Node.js, and Socket.IO. The platform enables users to transfer files directly between browsers without uploading data to a central server.

A signaling server is used only for connection setup. File data never passes through the server, ensuring privacy, reduced infrastructure costs, and faster transfers.

---

## Problem Statement

Traditional file-sharing platforms rely on centralized servers, leading to storage costs, bandwidth expenses, privacy concerns, and transfer limitations.

This project addresses these issues by establishing a direct browser-to-browser connection using WebRTC, allowing secure and decentralized file transfers.

---

## Features

### Core Features

* Direct browser-to-browser file transfer using WebRTC
* Unique Room ID generation
* Real-time Socket.IO signaling server
* Drag-and-drop file selection
* Chunk-based file transfer
* SHA-256 integrity verification
* Transfer progress tracking
* Transfer speed monitoring (MB/s)
* Estimated time remaining (ETA)
* Automatic file download on completion
* Real-time connection status indicator
* Peer disconnection handling
* Built-in peer-to-peer chat

### Security Features

* Direct P2P communication
* No file storage on the server
* SHA-256 hash verification
* TURN/STUN assisted WebRTC connectivity

---

## Tech Stack

### Frontend

* React.js
* Tailwind CSS
* WebRTC API

### Backend

* Node.js
* Express.js
* Socket.IO

### Networking

* WebRTC Data Channels
* STUN Servers
* TURN Servers

### Deployment

* Frontend: Vercel
* Backend: Render

---

## System Architecture

Sender Browser
↓
Socket.IO Signaling
↓
Receiver Browser

After signaling:

Sender Browser ⇄ WebRTC Data Channel ⇄ Receiver Browser

The signaling server only exchanges WebRTC offers, answers, and ICE candidates.

No file content is stored or processed by the server.

---

## Transfer Workflow

1. Sender selects a file.
2. Sender generates a Room ID.
3. Receiver enters the Room ID.
4. Socket.IO establishes signaling.
5. WebRTC connection is created.
6. File metadata is exchanged.
7. File is split into chunks.
8. Chunks are transmitted through the WebRTC Data Channel.
9. Receiver reconstructs the file.
10. SHA-256 hashes are compared.
11. File is automatically downloaded after successful verification.

---

## Project Structure

```text
P2P-Web-Share
│
├── client
│   ├── src
│   │   ├── components
│   │   │   ├── SenderView.jsx
│   │   │   ├── ReceiverView.jsx
│   │   │   ├── ChatBox.jsx
│   │   │   └── DropZone.jsx
│   │   │
│   │   ├── hooks
│   │   │   └── useWebRTC.js
│   │   │
│   │   └── App.jsx
│   │
│   └── package.json
│
├── server
│   ├── index.js
│   └── package.json
│
└── README.md
```

---

## Installation

### Clone Repository

```bash
git clone https://github.com/your-username/P2P-Web-Share.git
cd P2P-Web-Share
```

### Backend Setup

```bash
cd server
npm install
npm start
```

### Frontend Setup

```bash
cd client
npm install
npm run dev
```

---

## Usage

### Sender

1. Select a file.
2. Click Generate Share Code.
3. Share the Room ID with the receiver.

### Receiver

1. Enter the Room ID.
2. Click Join & Receive.
3. Wait for transfer completion.
4. File downloads automatically after verification.

---

## Achievements

* Direct browser-to-browser file transfer
* No centralized file storage
* Secure SHA-256 verification
* Real-time transfer monitoring
* Cross-browser WebRTC support
* Peer-to-peer messaging support

---

## Future Improvements

* Multi-peer file sharing
* Large file streaming (>500 MB)
* End-to-end AES-GCM encryption
* Download resume support
* Mesh-based swarm downloading
* Mobile application support

---

## Authors

Komal Mahawar
Chemical Engineering, IIT Roorkee

---

## License

This project is developed for educational and academic purposes.
