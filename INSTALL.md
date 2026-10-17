# Installing PokeSurvivor Plus

PokeSurvivor Plus is a browser extension for [pokesurvivor.com](https://pokesurvivor.com/). Until it's available on the Chrome Web Store (**coming soon**), you install it by hand. It takes about two minutes.

**Supported:** Chromium-based desktop browsers — Google Chrome, Microsoft Edge, Brave, Opera and others built on Chromium.
**Not supported yet:** Firefox, Safari and mobile browsers.

---

## 1. Download

1. Go to the [latest release](https://github.com/PokeSurvivorPlus/PokeSurvivorPlus/releases/latest).
2. Under **Assets**, download **`pokesurvivor-plus-1.0.0.zip`** (not the “Source code” files).
3. Extract (unzip) it. You get a folder called **`pokesurvivor-plus-1.0.0`** with `manifest.json` inside.
4. Move that folder somewhere permanent, such as your Documents folder. **Don't delete it later:** the browser loads the extension from this folder.

## 2. Load it in your browser

### Google Chrome

1. Open a new tab and go to `chrome://extensions`.
2. Turn on **Developer mode** (switch at the top right).
3. Click **Load unpacked**.
4. Select the **`pokesurvivor-plus-1.0.0`** folder (the one that contains `manifest.json`) and confirm.

### Microsoft Edge

1. Go to `edge://extensions`.
2. Turn on **Developer mode** (in the left-hand panel; on narrow windows, open the menu ☰ first).
3. Click **Load unpacked** and select the **`pokesurvivor-plus-1.0.0`** folder.

### Brave

1. Go to `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`pokesurvivor-plus-1.0.0`** folder.

### Opera

1. Go to `opera://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`pokesurvivor-plus-1.0.0`** folder.

### Other Chromium browsers

Open the browser's extensions page, turn on developer mode and use **Load unpacked** with the same folder.

## 3. Play

1. Open (or reload) [pokesurvivor.com](https://pokesurvivor.com/).
2. You'll see the gold **Play** and purple **Endless** buttons, and **PokeSurvivor Plus v1.0.0** at the bottom left of the main menu. New players get a short welcome tour.
3. All options are in the game's **Settings** screen (the gear in the top bar).

> **Tip:** pin the extension from the browser's puzzle-piece menu if you like, but you don't need to: it runs on its own whenever pokesurvivor.com is open.

---

## Updating to a new version

1. Download the new zip from the [releases page](https://github.com/PokeSurvivorPlus/PokeSurvivorPlus/releases) and extract it.
2. Either replace the contents of your existing folder with the new files, **or** remove the old extension and load the new folder as in step 2.
3. On the extensions page, click the reload arrow (↻) on the PokeSurvivor Plus card, then reload pokesurvivor.com.

Your settings, bindings, favourites, records and run history are kept: they're saved on pokesurvivor.com in your browser, not in the extension folder. To be safe before big changes, use **Settings → Extras → Backup → Export**.

## Uninstalling

Open your browser's extensions page and click **Remove** on PokeSurvivor Plus, then delete the folder. Your PokeSurvivor Plus data stays in the browser until you clear pokesurvivor.com's site data (your game progress is the game's own and isn't affected by the extension).

## Troubleshooting

| Problem | What to do |
|---|---|
| “Manifest file is missing or unreadable” | You picked the wrong folder. Select the folder that directly contains `manifest.json` (not the zip, and not a folder above it). |
| Nothing changes on pokesurvivor.com | Reload the game page after loading the extension. Check the extension is switched on in the extensions page. |
| The browser warns about developer-mode extensions | Expected for extensions loaded by hand. Keep developer mode on, or the extension is turned off. |
| A feature stopped working after a game update | Open **Settings → Extras → Status**: PokeSurvivor Plus switches off just the part that broke. Check for a newer release, and [report it](https://github.com/PokeSurvivorPlus/PokeSurvivorPlus/issues). |
| The controller isn't detected | Press any button on it once: browsers only report a controller after it has been used on the page. |
| Tier letters don't appear | Press **Tiers** on the Pokémon screen. The list is downloaded from survivortiers.pages.dev; if the site can't be reached, the last saved copy is used. |

Still stuck? [Open an issue](https://github.com/PokeSurvivorPlus/PokeSurvivorPlus/issues/new/choose) with your browser and what you see.
