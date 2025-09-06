# 📅 Todoist Daily Planner — Chrome Extension

A Chrome Extension that helps you **plan your day in Todoist**.
Instead of juggling dozens of tasks, this extension pulls today’s tasks into a step-by-step flow where you can **reschedule, reprioritize, and tag tasks** quickly — so you start each day with a clear plan.

---

## ✨ Features

* **🔑 Seamless Todoist integration**

  * Paste your API token once (stored safely in `chrome.storage.sync`).
  * Tasks are pulled in real time from your Todoist account.

* **📋 Daily task review**

  * Fetches all tasks scheduled for **Today**.
  * Shows them one by one, so you can focus on decisions instead of a long list.

* **📆 Rescheduling made simple**

  * Quickly move tasks to:

    * **Today**
    * **Tomorrow**
    * **Next Tuesday**
    * **Next Saturday**
  * Or pick a **Custom Date** via calendar picker.

* **🏷️ Smart label grouping**

  * Assign multiple labels while reviewing:

    * **Urgency**: `urgent-now`, `urgent-today`, `urgent-soon`
    * **Pressure**: `high-pressure`, `low-pressure`
    * **Quick wins**: `low-hanging-fruit`

* **🔁 Recurring task support**

  * Handles recurring tasks correctly with Todoist’s `due_string` rules.
  * Uses `/postpone` for reliable “Tomorrow” rescheduling.

* **✅ Smooth workflow**

  * Submit updates → extension calls Todoist API to reschedule and relabel.
  * Move through all tasks until your list is clear.
  * Finish with a motivational screen: **“We are ready for the day! ✨”**

---

## 📸 Screenshots

*(replace placeholders with actual captures from Chrome once extension runs)*

### 1. Start Screen

![Start screen](./screenshots/start.png)

### 2. Task Review

![Task review screen](./screenshots/task-review.png)

### 3. Custom Date Picker

![Custom date picker](./screenshots/custom-date.png)

### 4. Labels Grouped

![Labels grouped](./screenshots/labels.png)

### 5. All Done!

![Done screen](./screenshots/done.png)

---

## 🛠️ Installation

1. Clone or download this repository.

   ```bash
   git clone https://github.com/yourusername/todoist-daily-planner.git
   ```
2. Open **Chrome** → go to `chrome://extensions/`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. The extension icon will appear in your Chrome toolbar.

---

## ⚙️ Setup

1. Open the extension popup.
2. On first use, paste your **Todoist API token**:

   * Find it in Todoist → Settings → Integrations → API token.
3. Click **Plan my day**.

---

## 🚀 Usage

* Review each task in turn.
* Choose a new **date** (preset or custom).
* Assign one or more **labels**.
* Hit **Submit**.
* Continue until all tasks are processed.

At the end, you’ll see a success message telling you your day is ready.

---

## 📂 Project Structure

```
.
├── manifest.json        # Chrome Extension manifest (MV3)
├── popup.html           # Main UI
├── popup.css            # Styling
├── popup.js             # Logic + Todoist integration
├── icons/               # Extension icons (16, 32, 48, 128px)
└── README.md            # This file
```

---

## 🔐 Security Notes

* The API token is stored locally in Chrome’s `storage.sync` (never uploaded).
* This extension talks directly to Todoist’s API over HTTPS.

---

## 🛣️ Roadmap

* [ ] Dark mode UI
* [ ] Keyboard shortcuts
* [ ] Support for custom label sets
* [ ] Analytics: show how many tasks you moved per day/week

---

## 📜 License

MIT License © 2025 \[Jay Teli]
