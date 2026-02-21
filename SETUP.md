# Meal Planner — Setup & User Guide

**Live App:** https://scjedi.github.io/meal-planner/

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [The Five Tabs](#the-five-tabs)
3. [Managing Recipes](#managing-recipes)
4. [Importing Recipes with AI](#importing-recipes-with-ai)
5. [Planning Your Meals](#planning-your-meals)
6. [Shopping List](#shopping-list)
7. [Cooking Plan & Batch Cooking](#cooking-plan--batch-cooking)
8. [Cloud Sync Setup (Share Across Devices)](#cloud-sync-setup-share-across-devices)
9. [AI Recipe Import Setup (Optional)](#ai-recipe-import-setup-optional)
10. [Data & Privacy](#data--privacy)
11. [Backing Up Your Data](#backing-up-your-data)
12. [Deploying Your Own Copy](#deploying-your-own-copy)
13. [File Structure (For the Curious)](#file-structure-for-the-curious)
14. [Troubleshooting](#troubleshooting)
15. [Tips & Tricks](#tips--tricks)

---

## Getting Started

The Meal Planner is a free web app — no download, no account required.

**Open it in any modern browser:**
> https://scjedi.github.io/meal-planner/

That's it. It works on phones, tablets, and computers. The dark theme is easy on the eyes and the buttons are sized for touch screens.

Your recipes and meal plans are saved automatically in your browser. They stay there until you clear your browser data. To keep them safe across devices or browser resets, set up [Cloud Sync](#cloud-sync-setup-share-across-devices) and do regular [backups](#backing-up-your-data).

---

## The Five Tabs

| Tab | What It Does |
|-----|-------------|
| **Recipes** | Store and manage all your recipes |
| **Planner** | Assign recipes to days of the week |
| **Shop** | Auto-generated shopping list from your meal plan |
| **Plan** | View planned meals filtered by meal category |
| **Cook** | Batch cooking guide for preparing everything at once |

---

## Managing Recipes

### Adding a Recipe Manually

1. Tap the **Recipes** tab.
2. Tap **Add Recipe** (or the + button).
3. Fill in the recipe name, ingredients, instructions, and category.
4. Categories: Breakfast, Lunch, Dinner, Snack, Dessert.
5. Tap **Save**.

### Editing or Deleting a Recipe

- Tap any recipe card to open it.
- Use the **Edit** button to make changes.
- Use the **Delete** button to remove it permanently.

### Searching and Filtering

- Use the **search bar** to find recipes by name or ingredient.
- Use the **category filter** to show only Breakfast, Dinner, etc.

---

## Importing Recipes with AI

The **Import** button (in the Recipes tab) lets you pull in recipes from almost anywhere — a website, a photo, a PDF, or just text you copied. You don't need AI set up to use this feature, but AI makes it significantly more accurate.

### Ways to Import

| Method | How to Use |
|--------|-----------|
| **Paste Text** | Copy recipe text from anywhere, paste it in the text box |
| **Photo(s)** | Upload one or more photos of a recipe (handwritten, printed, etc.) |
| **URL** | Paste a link to any recipe website |
| **PDF** | Upload a PDF file containing a recipe |
| **Drag & Drop** | Drag any file or image onto the import window |

**Multiple photos:** If a recipe spans several pages, upload all the photos at once. They'll be combined into a single recipe automatically.

### With vs. Without AI

| | Without AI | With AI |
|-|-----------|--------|
| Text recipes | Works well | Works great |
| Clear printed photos | Works okay | Works great |
| Handwritten recipes | Poor results | Much better |
| Messy or complex layouts | Poor results | Much better |
| Recipe websites | Works for standard sites | Works for all sites |

If AI is not configured, the app uses OCR (optical character recognition) and pattern matching. This works fine for clean printed text. For photos, handwriting, or unusual formats, setting up an AI provider (see below) gives much better results.

---

## Planning Your Meals

1. Tap the **Planner** tab.
2. Choose how many days you want to plan (1 to 14 days).
3. Tap a day slot and select a recipe from your collection.
4. Repeat for each meal.

Your plan is saved automatically.

---

## Shopping List

1. Tap the **Shop** tab.
2. The app automatically generates a shopping list from everything in your Meal Plan.
3. Items are grouped by store category (produce, dairy, meat, etc.) for efficient shopping.
4. Tap any item to check it off as you shop.

---

## Cooking Plan & Batch Cooking

- The **Plan** tab shows your scheduled meals, filterable by meal category (e.g., just see all dinners).
- The **Cook** tab generates a **batch cooking guide** — a step-by-step plan for preparing multiple recipes at once efficiently.

---

## Cloud Sync Setup (Share Across Devices)

By default, your data is saved only in the browser you're using. Cloud Sync lets you share your recipes and meal plan across multiple devices (phones, tablets, computers) and keeps everything backed up in the cloud.

This uses Google Firebase — a free service. You're creating your own private database that only you control.

### Step-by-Step Setup

**1. Create a Firebase Project**

1. Go to https://console.firebase.google.com
2. Sign in with a Google account (Gmail works).
3. Click **Add project**.
4. Give it any name you like (e.g., `family-meal-planner`).
5. When asked about Google Analytics, **turn it off** — you don't need it.
6. Click **Create Project** and wait for it to finish.

**2. Create a Database**

1. In the left sidebar, click **Build** → **Realtime Database**.
2. Click **Create Database**.
3. Choose the region closest to you:
   - `United States` — if you're in North America
   - `Europe` — if you're in Europe
   - `Asia` — if you're in Asia/Pacific
4. Select **Start in test mode** → click **Enable**.

**3. Fix the Security Rules (Important!)**

Without this step, Firebase will automatically lock your database after 30 days.

1. Click the **Rules** tab at the top of the Realtime Database page.
2. You'll see some text. Replace ALL of it with:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
3. Click **Publish**.

**4. Copy Your Database URL**

1. Click the **Data** tab.
2. At the top of the page, you'll see a URL that looks like:
   `https://your-project-name-default-rtdb.firebaseio.com`
3. Copy that full URL.

**5. Connect the App**

1. Open the Meal Planner app.
2. Go to **Settings** → **Cloud Sync**.
3. Toggle **Enable Cloud Sync** on.
4. Paste your Firebase URL into the field.
5. Click **Test Connection** — you should see a success message.

**6. Upload Your Existing Data**

1. Click **Push Local Data to Cloud** to send your current recipes and meal plan to the cloud.

**7. Connect Other Devices**

On each additional phone, tablet, or computer:
1. Open the app in the browser.
2. Go to **Settings** → **Cloud Sync** → Enable it.
3. Paste the same Firebase URL.
4. Click **Pull Cloud Data to Local** to download everything.

### How Sync Works After Setup

- Changes are saved to the cloud within **2 seconds** of any edit.
- The app checks for updates from other devices every **30 seconds**.
- You don't need to do anything — it's fully automatic.

> **Note:** Recipe photos are NOT synced. Photos are stored only in the local browser due to size limits on the free Firebase plan. Your recipe text, ingredients, and instructions all sync normally.

---

## AI Recipe Import Setup (Optional)

You can optionally connect an AI service to improve recipe import accuracy — especially for photos, handwriting, and complex recipe layouts.

Three AI providers are supported. Pick one:

### Option A — Anthropic (Claude)

Best choice for recipe parsing accuracy.

1. Go to https://console.anthropic.com
2. Sign in or create an account.
3. Click **API Keys** in the left sidebar.
4. Click **Create Key**, give it a name, copy the key.

### Option B — OpenAI (GPT)

Good alternative if you already have an OpenAI account.

1. Go to https://platform.openai.com
2. Sign in or create an account.
3. Click **API Keys** in the left sidebar.
4. Click **Create new secret key**, copy the key.

### Option C — OpenRouter

Gives you access to many AI models from different companies through one account.

1. Go to https://openrouter.ai
2. Sign in or create an account.
3. Click **Keys** → **Create Key**, copy the key.

### Connecting AI to the App

1. Open the Meal Planner app.
2. Go to **Settings** → **AI Recipe Import**.
3. Select your provider (Anthropic, OpenAI, or OpenRouter).
4. Paste your API key.
5. The available models will populate automatically — the default model is a good choice.
6. Save.

That's it. The next time you use the Import feature, you'll see an AI toggle option.

> **Privacy note:** Your API key is stored only in your browser. It is never sent to Firebase or shared anywhere.

---

## Data & Privacy

| What | Where It Goes |
|------|--------------|
| Recipes & meal plans (no sync) | Your browser only |
| Recipes & meal plans (with sync) | Your browser + your Firebase database |
| Recipe photos | Your browser only (never synced) |
| AI provider API keys | Your browser only (never synced) |
| Analytics/tracking | None — the app collects nothing |

**You own your data.** The Firebase database you create belongs to your Google account. The app developers have no access to it.

---

## Backing Up Your Data

Browsers can clear local storage when you clean up storage, clear cache, or reinstall. Export regularly to avoid losing recipes.

### Export

1. Go to **Settings** → **Data Management**.
2. Click **Export Data as JSON**.
3. Save the file somewhere safe (Google Drive, email to yourself, etc.).

### Import

1. Go to **Settings** → **Data Management**.
2. Click **Import from JSON**.
3. Select your backup file.

Tip: Export monthly, or any time you add a bunch of new recipes.

---

## Deploying Your Own Copy

The app is just 6 static files. No server, no database setup required for the basic app. You can host your own private copy for free using GitHub Pages.

### Using GitHub Pages (Recommended)

1. Go to https://github.com/SCJedi/meal-planner
2. Click **Fork** (top right) — this creates a copy under your GitHub account.
3. In your new repo, click **Settings** → **Pages** (left sidebar).
4. Under **Source**, select:
   - Source: `Deploy from a branch`
   - Branch: `master`
   - Folder: `/ (root)`
5. Click **Save**.
6. Wait about 2 minutes, then your app will be live at:
   `https://YOUR-GITHUB-USERNAME.github.io/meal-planner/`

### Running Locally (Simplest Option)

Download the files and open `index.html` in any browser. No internet connection required for the basic app.

---

## File Structure (For the Curious)

```
meal-planner/
├── index.html         # App layout and all pop-up windows (modals)
├── app.js             # Main app logic — recipes, planner, shopping list, cooking
├── recipe-loader.js   # Recipe import — AI, OCR, URL, PDF, text parsing
├── sync.js            # Firebase cloud sync module
├── styles.css         # Dark theme and layout styling
├── README.md          # Project overview
└── SETUP.md           # This file
```

---

## Troubleshooting

### Sync Issues

| Problem | Solution |
|---------|---------|
| "Sync error" after pushing data | Open browser console (press F12 → Console tab) and look for the error. Usually the Firebase URL is typed incorrectly. |
| Test Connection works, but sync still fails | Your Firebase Rules may not have been saved correctly. Redo Step 3 of the Cloud Sync setup above. |
| Data on one device doesn't show on another | Tap "Pull Cloud Data to Local" manually on the other device. Or wait up to 30 seconds for auto-sync. |

### AI Import Issues

| Problem | Solution |
|---------|---------|
| "No AI configured" message | Go to Settings → AI Recipe Import → add your API key. |
| AI key not working | Double-check the key was copied completely (no extra spaces). Make sure your AI provider account has credits. |
| Poor results from photos | Use better lighting. Make sure text is in focus. AI does much better than OCR with unclear photos. |

### Data Issues

| Problem | Solution |
|---------|---------|
| All data disappeared | Browser storage was cleared. Restore from a JSON export backup (Settings → Data Management → Import). Enable Cloud Sync to prevent this in the future. |
| Recipe photos disappeared | Photos are stored locally only and cannot be recovered if browser storage is cleared. This is a known limitation. |

### GitHub Pages Issues

| Problem | Solution |
|---------|---------|
| 404 error after deploying | Wait 2–3 minutes after the first deploy. GitHub takes time to set up. |
| Still 404 after waiting | Go to repo Settings → Pages → confirm the source branch is set to `master` and folder is `/ (root)`. |
| Changes not showing up | GitHub Pages caches files. Wait a few minutes and do a hard refresh (Ctrl+Shift+R or Cmd+Shift+R). |

---

## Tips & Tricks

- **Export regularly.** Use Settings → Data Management → Export Data as JSON at least once a month. Email the file to yourself for safekeeping.

- **Best photo results.** Good lighting and a flat surface make a big difference for photo imports. AI handles shadows and angles much better than OCR alone.

- **Multi-page recipes.** If a recipe is on multiple pages or cards, select all the photos at once when importing. The app will combine them into one recipe.

- **Drag and drop anywhere.** You can drag a file, photo, or URL link directly onto the import window — you don't have to use the buttons.

- **Shopping list efficiency.** The shopping list groups items by store section (produce, dairy, pantry, etc.). This matches the typical layout of most grocery stores, so you can work through the list aisle by aisle without backtracking.

- **Batch cooking.** The Cook tab is especially useful for meal prep — it organizes everything so you can work on multiple recipes at once without losing track.

- **Free Firebase.** The free Firebase plan (Spark) is generous for personal use. A family's worth of recipes and meal plans will stay well within the free limits.

---

*Last updated: February 2026*
