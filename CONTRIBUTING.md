# Contributing to Whats4Linux

Thank you for your interest in contributing to **Whats4Linux**!  
Contributions of all kinds are welcome — code, documentation, bug reports, and performance improvements.

This document outlines how to get started and what we expect from contributors.

---

## 📌 Before You Start

- Please **search existing issues** before opening a new one.
- For **major changes or new features**, open an issue first to discuss the proposal.
- Keep changes **focused and minimal** — smaller PRs are easier to review.

---

## 🛠 Development Setup

### Prerequisites

- Go **1.25+**
- Node.js **20.19.6+**
- Wails v2
- Platform dependencies:
  - **Linux**: `gtk3`, `webkit2gtk`, and `gst-plugins-good` (runtime — required for
    audio/video playback; WebKitGTK's media pipeline needs it, and without it the
    web process crashes when a message with media is opened)
  - **Windows / macOS**: follow Wails platform setup

Refer to the official Wails documentation for platform-specific setup.

---

### Clone the Repository

```bash
git clone https://github.com/lugvitc/whats4linux.git
cd whats4linux
```

### Install Frontend Dependencies

The frontend is a web-based UI rendered using WebKit via Wails.

```bash
cd frontend
npm install
```

### Run in Development Mode

To start Whats4Linux in development mode:

```bash
wails dev
```

This will:
- Start the native Go backend
- Launch the WebKit-based UI
- Enable hot-reloading for changes

**Notes**
- Ensure you have the required platform dependencies installed.
- If you encounter issues, refer to the Wails documentation.

--- 
## 🧠 Project Structure Overview

```
|
├── api/ # Go APIs exposed to the frontend via Wails
├── internal/ # Core application logic (storage, sync, utils)
├── frontend/ # Web UI (HTML / CSS / JS)
├── build/ # Build artifacts and scripts
├── main.go # Application entry point
└── wails.json # Wails configuration
```


### Structure Guidelines

- **Business logic lives in Go**, not in frontend JavaScript.
- Keep the frontend **thin and state-light**.
- Avoid duplicating caches in both Go and JS. (Cache only in Go)
- Use Wails bindings to call Go functions from the frontend.
- Prefer streaming or pagination over loading large datasets.
- Platform-specific behavior should be handled in the backend wherever possible.

This structure is designed to keep performance-critical logic native, while maintaining a clean separation between UI and core application logic.

---

## 🧩 Code Guidelines

### **Go**
- Prefer clear, explicit code over clever abstractions
- Follow Go idioms and best practices
- Use api struct for global states
- Optimize for read-heavy workloads (chat history)
- Be mindful of memory allocations in hot paths

### **Frontend**
- Keep components small and composable
- Avoid excessive frontend-side caching
- Delegate data-heavy work to the Go backend
- Be mindful of DOM size and re-render frequency

---

## 🧪 Testing & Validation

Before submitting a pull request, ensure:
- The project builds successfully
- Basic flows work as expected:
    - Application startup
    - Chat list loading
    - Message pagination
    - Media loading (where applicable)
- No unnecessary debug logs are left behind

Automated tests are encouraged but not mandatory.

---

## 📦 Commits & Pull Requests

### ***Commit Messages***

Use clear, conventional commit-style messages:
```
<type>(<scope>): <short summary>

feat: add media cache eviction logic
fix: resolve message ordering bug
docs: update contributing guidelines
refactor: simplify chat list rendering
chore: update dependencies
```

### ***Pull Requests***

- Keep PRs focused on a single logical change
- Clearly explain what was changed and why
- Reference related issues when applicable
- Avoid unrelated formatting or refactors

---

## 🔐 Security Considerations

- Do not log sensitive user data
- Do not weaken encryption or protocol handling
- Do not expose internal APIs unnecessarily
- Report security issues privately (see SECURITY.md)

---

## ⚠️ What Not to Do

- Do not introduce Electron, Chromium, or Node-based runtimes
- Do not add analytics or telemetry
- Do not rely on WhatsApp Web or browser automation
- Do not introduce heavy frontend frameworks without prior discussion

---
