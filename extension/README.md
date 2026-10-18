# PokeSurvivor Plus

A browser extension for [pokesurvivor.com](https://pokesurvivor.com/) (formerly "PokéSurvivor Mod") that adds:

- **Shiny twinkle and low health glow:** shiny Pokémon (yours and teammates') twinkle now and then; a soft red glow surrounds the screen under 20% health (Settings → HUD & UI).
- **Spanish:** with the game in Español (Settings → Accessibility → Language), PokeSurvivor Plus's own menus, settings, panels, tooltips and messages are in Spanish too (What's new keeps its English history).
- **Welcome tour and What's new:** New players get a six-card tour of the main features (A / B on a controller; replay it from Settings → Extras → Help). The game's **What's new** screen has a PokeSurvivor Plus tab listing every version's changes; its dot lights up after an update.
- **Safety net:** Each part of the extension is checked against the game. If a game update breaks one, just that part switches off (for example, the redesigned HUD falls back to the game's own), the rest keeps working, and a notice points to **Settings → Extras → Status**, which lists every feature.
- **Tier list letters:** Press **Tiers** on the Pokémon screen (or Settings → Extras → Tier list) to show each Pokémon's tier, S to D, from the community tier list [SurvivorTiers](https://survivortiers.pages.dev/en/) by [@fildotai](https://x.com/fildotai): a letter on every grid cell, and the tier, rank and a link to its SurvivorTiers page under the name on each Pokémon's page. The list is downloaded by the extension (that's why it asks for access to survivortiers.pages.dev) when you switch it on, kept for a day, and the last copy is used if the site can't be reached. Off by default.
- **More music:** 42 new tracks written in the game's own format and played by its synthesiser, so they fit the soundtrack: five more for the main menu (it changes song every couple of minutes), four more for each area (forest, cave, volcano), five more for boss fights, two more for Arceus's Judgment, and three for each family of rift arenas (fire / ground / rock, water / ice / flying, grass / bug / fairy / normal, electric / steel / psychic, ghost / dark / poison, dragon / fighting). Each time you reach a place or start a fight, one of its options is picked at random, never the one you heard there last time; after a boss fight or a rift, the area's song carries on. A song always plays on the main menu (also after a run), and when a new one starts its name slides in at the bottom right of the menu for about 15 seconds (not while the music is muted or at 0%). Turn off in Settings → Audio, which also shows what's playing.
- **Main menu:** The PokeSurvivor Plus version sits at the bottom left (click it for what's new). **Play** (“Face the Judgment of Arceus”) is a big gold button on its own at the top of the menu, with bold lettering and a light that sweeps across it; **Endless** is the same size just below it, in purple. Every other option is its own button. **View / Select** on a controller (its prompt sits beside the switch), or **Tab**, swaps your partner between Normal and Shiny. The Pokémon wandering behind the menu are sometimes shiny (about 1 in 64). **Stats** (the game's Leaderboard item) opens your runs and records first, with the leaderboard as a second tab; the game's totals (runs, best time, best level, defeated) moved there. The Settings item is gone (the gear in the top bar opens Settings), **Quit** is a red ✕ button at the far right of the top bar (it saves what's pending, then closes the tab), and **Support** sits in the top-left corner. Settings, sound, full screen and What's new light up under the mouse like Quit. To log out, click your name in the top bar (your profile) and press **Log out** (twice for a guest, whose progress isn't saved); it's also in Settings → Account. The crown beside your name is gone. The menu scales down to fit short windows, and a different splash text (over a hundred, some of them jokes) pulses under the logo each time you come back.
- **Endless runs:** The big purple **∞ Endless** button under Play (“Take on an endless gauntlet of Pokémon”) starts an endless run; the gold **Play** button starts a normal one. Arceus's Judgment doesn't come at 30:00: the run goes on the way runs did before the Judgment was added (the game's old "extra time": nothing changes until minute 60, then enemy health, and a little less their damage, grows faster and faster: ×1.4 at 90 min, ×3.8 at 2 h, also for bosses and rift legendaries), rifts keep opening and a boss comes every 3 minutes, as in the first 15 minutes. Summon Arceus from the pause menu (which says “∞ Endless run” at the top) to end the run with the Judgment (in co-op only the host can start an endless run or summon Arceus). To keep the game fair, an endless run is never registered with or sent to the leaderboard (Arceus or not), unlocks no achievements, and leaves the game's stats exactly as they were: runs, best time (solo and co-op), best level, defeated, bosses and legendaries. Coins, tickets, missions and Pokémon you catch are kept as in any run. Endless records (best time solo and co-op, best level, number of runs) are kept separately in Stats, and endless runs carry an ∞ badge on the clock panel, in your run history, on the end-of-run screen and on share cards. (Teammates without PokeSurvivor Plus play along, but their game counts the run as a normal one.)
- **Room on the main menu (co-op):** No separate room screen: while you're in a room, the party, the room's status (connecting, ready), its chat and Invite / Leave room sit under your partner. **Play** starts the co-op run for everyone (host), says who you're waiting for (guest), or plays solo if you're alone in the room.
- **Backup:** Settings → Extras → Backup exports all PokeSurvivor Plus settings, bindings, favourites, records and runs to a file, and imports it again (the page reloads to apply it).

- **Damage meter:** Hold `Tab` (or press Select/View on a controller) to bring it up: each player's total damage, damage per second and share of the team's damage, plus who is down. Click your row to see damage from each of your attacks. The panel grows with its content and shrinks itself to fit the screen. In Settings → Controls → Damage panel key, choose **Press to toggle** to make `Tab` show and hide it instead of holding; Settings → HUD & UI → “Always show the damage panel” keeps it on screen. `Tab` no longer cycles attacks in the game, and learning a new move no longer switches you to it.
- **Upgrades:** Listed under the damage rows whenever the damage panel is up, your multipliers and stats (damage, cooldown, speed, defense, regeneration, critical hits, magnet, experience, active upgrades, and item). In co-op, it also shows shared Learning, team experience, and enemy scaling per player.
- **Fewer notifications:** The only pop-ups left are a shiny appearing and a teammate going down (with sound). The game's messages in the middle of the screen (wild Pokémon, events, rifts, biome names…) are hidden by default; turn each kind back on in Settings → Notifications.
- **Clock panel:** The run time sits on its own plate at the top; under it, a strip shows the biome, defeated enemies (skull), coins and the tickets (×1 and ×10, with ticket icons) picked up this run. Hover the weather tag under it to see what that weather changes. (New HUD only.)
- **Rifts:** While a rift is open and out of view, it gets an arrow in the same style as the others, with a new swirl icon; on screen, a small tag floats over the portal. Inside the rift arena, a glowing purple card under the clock counts down the fight. (New HUD only.)
- **Treasure thieves:** When a Meowth (coins) or Gholdengo (×10 ticket) shows up, a tag under the clock says what it carries and drains as its 15 seconds run out, then reads “CAUGHT!” or “GOT AWAY”. Out of view, it gets a gold arrow with its portrait, a coin or ticket badge, the distance and time left; on screen, a small timer floats over its head. (New HUD only; the classic HUD keeps the game's arrow.)
- **Spectate while down (co-op):** While you wait to be revived, the camera follows a teammate, and a “SPECTATING NAME” tag sits just above your HUD. Switch with previous / next attack (Q / E, mouse wheel, LB / RB). An arrow points back to where you fell, and the camera snaps back to you once your revive is 75% done. When the host also has PokeSurvivor Plus, it sends you the enemies around the player you're watching (closest 70, only while you spectate); otherwise you'll see the teammate but not the enemies around them ("limited view"). Can be turned off in Settings → Extras → Co-op.
- **Pause for everyone (co-op):** The host can pause the whole game from the pause menu: enemies, the timer and spawns stop for every player, even teammates without the extension. Anyone with PokeSurvivor Plus can also vote to pause (or to resume) from the pause menu; it happens once half the players have voted (1 of 2, 2 of 3, 2 of 4), and votes run out after 30 seconds. While paused, a panel shows who paused, the host's Resume button or a guest's Vote to resume, and Settings. Esc / P (Start) on that panel resumes (host) or votes (guest). The host needs PokeSurvivor Plus.
- **Pings (co-op):** Hold **G** (or click in the right stick, R3) for a wheel: point the mouse or the right stick at **Help**, **Boss**, **Chest** or **Here** and let go; a quick tap pings Here where you point. Pings go where your mouse is (on a controller, where you stand); Help follows you, and a Boss ping placed on a boss follows it. Pings show for 6 seconds with a marker in the world, or an arrow at the screen edge, a short sound (different for each kind) and a line in the chat. Rebind in Settings → Controls; turn pings, their chat lines or their sounds off in Settings → Notifications (or Extras).
- **Chat (co-op):** A chat box in the room (lobby) and, during a run, press **Enter** to type (Enter sends, Esc closes); recent messages fade in the bottom-left corner and pop up in a bubble over the sender's Pokémon for a few seconds (turn the bubbles off in Settings → Extras). Messages go straight between players' browsers over the game's existing connection; nothing is stored. Only players with PokeSurvivor Plus see it, and the host must have it too. Typing never moves your Pokémon, and a short sound confirms a sent message (Settings → Extras → Chat sound).
- **Fewer co-op disconnects:** If the peer connection drops, the mod waits up to 30 seconds for it to return instead of immediately removing the player. It also helps prevent Chrome from discarding the game tab to save memory. Events are recorded in a log.
- **Party on the main menu:** When you're in a group, a strip under your partner, centred with the PokéSurvivor title, shows every member, the Pokémon they've picked and its upgrade level (★ marks the host, ✦ a shiny). Teammates' levels show when they also use PokeSurvivor Plus; it adds your level to your entry in the group's room.
- **Upgrades screen:** Tighter upgrade cards, Ban's "Choose" button inside its card, and **Move shortcuts** filling the rest of the last row; each shortcut opens a list of the Pokémon's moves with their type icons. Hover any move (shortcut, list or ban picker) to see what it does.
- **Max all upgrades:** On the Upgrades screen, one button next to the Pokémon picker buys every missing upgrade level for that Pokémon (click twice to confirm). If you can't afford them all, it buys as many levels as your coins cover, cheapest first. The total upgrade level (out of 90) is shown beside it.
- **Combined filters:** On the Pokémon screen, pick one of All / Owned / Missing / Shiny plus any number of rarities (e.g. Missing + Legendary + Epic), together with Favourites and the search. With Shiny (or a “shiny” search), the list shows each Pokémon as its shiny.
- **Favourite Pokémon:** Tap the **★** next to a Pokémon's name on its page; favourites get a star in the grid, and the **Favourites** chip shows only them, from every region. On the main menu, the arrows beside your partner swap between favourites; they show the key or button that does the same (Q / E on a keyboard, LB / RB or L1 / R1 on a controller), each remembering normal or shiny. Favourites are saved in this browser.
- **Pokémon page:** The sprite sits beside the name, rarity and types, with the Normal / Shiny switch underneath; below are base stats, **You and this Pokémon** (upgrade level and personal records) and its moves: every move it can learn as a chip with its icon, name and type colour (the starting move first, vetoed ones struck through). Hover a move for its type, kind, damage, cooldown, range and effects at level 1.
- **Personal records:** Every Pokémon keeps its longest run, highest level, most defeated, best damage/s and most damage, plus how many runs you've played with it. Beating one is announced at the end of the run and marked in the run's report.
- **Pokémon screen:** A search bar (by name or number; type **shiny** for every Pokémon whose shiny you have), **Sort** (Pokédex number, A–Z, HP, Attack, Speed or tier, either way round) and the **Tiers** button (see Tier list letters). A “National” tab at the start of the regions shows all Pokémon together. Leaving the screen clears the search and goes back to National with every filter off.
- **Runs & records:** **Stats** on the main menu (also a button on the game-over screen, or Alt + H) opens your totals and latest runs; click one to see its time, level, defeats, damage, damage per second, a **damage-over-time graph** (one line per player), strongest attacks and how friends did. **Share card** makes an image of the run to copy into a chat or save: the stats, a labelled damage-per-second graph and, in co-op, everyone's share of the team's damage. A red dot means a new run was saved. The last 30 runs are kept in this browser; ✕ on a run removes it (click twice).
- **Search boxes:** Settings has a search box that looks through every tab (the game's and PokeSurvivor Plus's) and jumps to the setting; Achievements searches every category at once; Friends gets a filter once the list is long, and the Upgrades picker a box that jumps to the Pokémon you type (closest name first, or a Pokédex number like 151).
- **Settings inside the game's Settings screen** (also reachable from the pause menu):
  - **Audio:** the game's volume sliders with percentages (also in the top bar's sound button and the pause menu) and Mute all, More music, and the alert sound (with a Test button).
  - **Graphics:** quality and display (the game's), field of view and attack effects, each with a live preview.
  - **HUD & UI:** HUD style and size (live preview of the whole HUD), bars (live preview), the minimap and its markers (live preview), the damage panel, and a debug view: **player hitboxes** and **enemy hitboxes**, each with its own switch (soft glowing discs where you can be hit: green for you, blue for teammates, red for enemies, orange for bosses; off by default) and the **FPS counter** (a small box you can drag anywhere).
  - **Notifications:** choose which pop-ups show (shiny, teammate down, new records, connection, controller, achievements, leaderboard records, Now playing), which of the game's messages in the middle of the screen show (wild Pokémon and bosses, events, rifts and the Judgment, biome and weather, items and powers, Pokémon caught, teammate left), and which arrows and tags (teammates, bosses, rifts, treasure thieves).
  - **Controls:** controller support and rumble, the damage panel key (hold or toggle) and every key/button binding (`Alt` + `K` jumps here). The game's “On PC” list is replaced by the bindings table.
  - **Accessibility:** language (moved from Graphics), colour blind mode with colour swatches, less shake and flashes (the game's setting) and fewer PokeSurvivor Plus animations.
  - **Extras:** co-op options (spectating, pings, chat, chat bubbles), tier list letters, backup, status, help and credits.
- **Colour blind mode:** A screen colour correction for protanopia (red), deuteranopia (green) or tritanopia (blue), tuned on the game's own colours: health red and heal green, Fire and Grass, Electric and Bug, Water and Grass, enemy and player hitboxes end up 3-5× further apart than without it. Strength adjustable from 20% to 160% (Settings → Accessibility). **Apply to** chooses UI only (menus, HUD and minimap; the Pokémon and the map keep their colours) or UI and Pokémon / scene (the whole page, the default).
- **Attack effects:** Opacity and size (down to 20%) sliders for your own attacks and, separately, your teammates' attacks (Settings → Graphics). Only the look changes; hit areas stay the same.
- **Bars:** In Settings → HUD & UI → Bars, with a live preview: colours for your health (including “by health”: green → yellow → red), teammates' health (including each player's colour), boss health and experience; a style for every bar (classic, flat, gradient, segmented, moving stripes) and a rainbow colour for any bar; numbers on your health bar (health / max, percent, off), on the experience bar (off, percent, level and percent) and the boss's percent; and thin / normal / thick health and experience bars.
- **Level-up screen:** Always the same size: fixed width, every card the same height (hover a card for its full description), and the reroll button keeps its space when you run out. **Pause · Esc** (Start on a controller) opens the pause menu and Settings over the cards; Continue brings them back.
- **Wider field of view:** Zooms the camera out to show more of the map (1.0x–1.7x; default 1.4x).
- **Redesigned HUD:** Teammate cards top-left (portrait, name, typing, health, level, Pokémon and held item — the item shows when they and the host use PokeSurvivor Plus); the weather under the clock; a boss plate below that (portrait that winces and shakes whenever it takes damage, enraged or not, and shows its angry face between hits when the boss is enraged, name, BOSS / LEGENDARY / ENRAGED tag, health bar with a lingering damage trail and hit flash, red glow below 25%); and a bottom bar with your boosts, the active move's name, health, portrait and level, your move slots and a full-width experience bar. Hover a move slot or your item to see its details (damage, cooldown, pierce, range, effects and next upgrade). Portraits use the normal face, a pained face for a moment after a real hit and a dizzy one when down.
  - **Arrows:** Teammates out of view get an arrow with their portrait. Bosses get their own, different arrow — a framed portrait in a pulsing red halo with a gold double chevron and “BOSS · N m” (purple for legendaries). Arrows stay clear of the team cards and the minimap, and slide apart when they'd overlap.
  - When you're down, the screen edge pulses red and a panel shows who can revive you and the revive progress; when you're reviving someone, a bar shows it.
  - Portraits come from SpriteCollab, the same artwork source the game uses for its sprites. Switch back to the game's original HUD with Settings → HUD & UI → HUD style → Classic (touch screens always use the original). The HUD can be scaled from 1x to 2x (default 1.4x).
- **Custom controls:** Rebind actions and use the mouse wheel or middle/side buttons. By default, the wheel switches attacks.
- **Controller support:** Play with an Xbox, PlayStation, Switch Pro or most other USB/Bluetooth controllers. Every action can be rebound, button prompts are drawn like the buttons (round face buttons coloured like Xbox / PlayStation, bumpers and triggers shaped like them), menus get a controller cursor (it reaches every top-bar button, fullscreen included, opens drop-down lists, starts on something you can see whenever a window opens and goes back to the button you used after a gacha pull) with button prompts built into the bottom of the open window (A Select · B Back · LB / RB Tabs; B also closes What's new) or at the bottom left of the main menu, LB / RB (or Q / E on a keyboard) switch tabs and LT / RT a window's second row of tabs (the leaderboard's Solo / Group), keeps to the open window (the top bar is reachable from the main menu only), and the controller rumbles when you take damage.
- **Fixes:** Long Pokémon names no longer push the ★ off the page; the Pokémon screen's region tabs are full size and Pokémon in the National list no longer stay grey balls after switching regions; What's new scrolls with the controller; the favourite picker's search box is in English.
- **Minimap:** Shows nearby terrain, friends, enemies, chests, and ground items. Sits slightly transparent in the top-right corner; drag it anywhere, and drag any corner to make it bigger or smaller (it resizes around its centre). Settings → HUD & UI → Minimap shows turns each kind of marker on or off (terrain, screen view, teammates, enemies, bosses, shinies, golden enemies and thieves, rifts, events, chests, altars, healing puddles, items). Healing puddles show as a green circle with a white cross, faded while they refill.
- **Clearer settings icon:** The gear on the Settings button (top bar, main menu, pause) is redrawn with eight teeth around a hole so it reads as a gear at button size.
- **Logo:** A glowing ⁺ after “PokéSurvivor” on the main menu shows the extension is loaded.
- **Translation fixes:** “levels” on the Upgrades picker, “Choose as partner” on the Pokémon screen, the co-op level-up line (“Still choosing: Misty and you”), and English names for the Paradox Pokémon (Great Tusk, Iron Valiant…).
- **Evolving a move** keeps the attack you had selected.
- **Faster gacha:** Skip the slot-machine animation, set it to always skip, and use “Pull All” to spend all tickets at once. Each button (Use ×1, Use ×10, Use ×10 ticket, Use all) shows what it does and what it costs; “Use ×10 ticket” glows, and “Use all” is teal with a glowing ticket and ×N pulls. Your tickets show as two counters.
- **Profiles:** A player's profile (Friends → their name) shows their three favourites as portraits with types and tier, their records as tiles with icons (best time, best co-op time; on your own, your best solo time), and whether a friend is online or in a run.
- **Big chests:** A clear opening meter (with the percentage) above a big chest while you open it, instead of the game's thin ring.

## Install (Chrome, Edge, Brave, Opera)

1. Extract the folder somewhere you won't accidentally delete it.
2. Open `chrome://extensions` (or `edge://extensions` in Edge).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Reload pokesurvivor.com.

To update, replace the folder's contents with the new version and click the reload arrow on the extension's card in `chrome://extensions`.

## Controls

| Action | How |
|---|---|
| Mod settings | Settings → Audio / Graphics / HUD & UI / Controls / Accessibility / Extras |
| Bindings | Settings → Controls, or `Alt` + `K` |
| Increase/decrease field of view | Settings → Graphics, or `Alt` + `+` / `Alt` + `-` |
| Reset field of view | Settings → Graphics, or `Alt` + `0` |
| HUD size and style | Settings → HUD & UI |
| Colour blind mode | Settings → Accessibility |
| Attack effect opacity / size | Settings → Graphics |
| Switch attacks with wheel | Wheel up: previous attack; wheel down: next attack |
| Show damage panel | Hold `Tab` (or press once if set to toggle), or Select/View on a controller (toggles) |
| Turn damage panel off/on | `Alt` + `M` |
| Move damage panel | Drag the “DAMAGE” title |
| View damage per attack | Click your row in the damage panel |
| Toggle alert sounds | Settings → Audio, or `Alt` + `B` |
| Run history | `Alt` + `H` |
| Your and team upgrades | Shown in the damage panel |
| Ping (co-op) | Hold `G` or the middle mouse button (R3 on a controller), point, let go |
| Chat (co-op) | `Enter` during a run; the room has its own box |
| Run reports and records | Stats on the main menu, or `Alt` + `H` |
| Tier letters | **Tiers** on the Pokémon screen |
| Quit the game | The red ✕ button, top right |
| Connection log | `Alt` + `L` |
| Show/hide minimap | `Alt` + `N` |
| Move minimap | Drag it anywhere |
| Resize minimap | Drag any of its corners |

## Controller

Default layout (Xbox names; PlayStation, Switch and Steam Deck / Steam Controller show their own button names, picked automatically or in Settings → Controls → Button prompts):

| Action | Button |
|---|---|
| Move | Left stick or D-pad |
| Previous / next attack | LB / RB |
| Attack or upgrade 1 / 2 / 3 | X / Y / B |
| Attack 4 | RT |
| Change upgrade | LT |
| Pause | Menu (Start) |
| Damage panel | View (Select), toggles |
| Menus | D-pad or left stick moves the yellow cursor (long screens scroll as you go), A selects, B goes back, LB / RB switch tabs (Settings, regions, What's new…). On the pause menu the cursor starts on Continue, and left / right moves the volume sliders |
| Welcome tour | A next, B skip, left / right step through the cards |
| Level-up, bond and item cards | X / Y / B (and RT for a 4th) pick a card directly; or move the cursor and press A |

- Rebind in Settings → Controls (`Alt` + `K`): click a button in the **Controller** column, then press a controller button or push a stick.
- If nothing happens, press any button on the controller once; browsers only report a controller after it has been used on the page.
- In menus, a bar at the top left (beside Support) shows the buttons that do something there (A Select, B Back, LB / RB Tabs or Favourites).
- While you're playing on the controller, the number badges on cards, the reroll hint and the move slots show controller buttons (X / Y / B / RT, LT) instead of 1 / 2 / 3 / 4 and R. Pressing a keyboard key switches them back.
- Controller support and rumble can each be turned off in Settings → Controls.
- The menu cursor skips the minimap and damage panel; those stay mouse-only.

Panels only appear during a run. Field of view, HUD size and panel positions are saved. The minimap and damage panel hide while the Settings screen is open.

## Repertoire

The game's Upgrades screen gets a new checkbox: “Start with one move even if Repertoire is owned.” When enabled, each run starts with one move as if you had not purchased Repertoire. Coins are not refunded, and you can toggle it at any time.

## Gacha

- **Skip animation:** A button appears below the slot machine to jump straight to the results.
- **Always skip:** Checkbox below the pull buttons. When enabled, the slot machine animation is skipped.
- **Pull All · N:** Spends all tickets on the selected banner and shows all cards together. It uses ×10 tickets first, then regular tickets in groups of ten (preserving the guaranteed epic per group), then any remainder one at a time.
- Tickets earned from achievements unlocked during a pull are awarded afterward and remain for the next pull.
- **Missing by region:** A table below the pull buttons showing Pokémon owned and missing per region, pulls until the guaranteed legendary on each banner, and the missing Pokémon list. The banner with the most missing Pokémon is highlighted in yellow.

## Minimap legend

| Marker | Meaning |
|---|---|
| White arrow in the center | You, pointing in your movement direction |
| White rectangle | Current screen view |
| Colored circles | Teammates, each with their own color |
| Small red dots | Regular enemies |
| Large red circle | Boss |
| Large purple circle | Legendary |
| Cyan circle | Shiny |
| Yellow circle | Golden enemy or thief |
| Purple ring | Rift (portal) |
| Yellow diamond | Map event |
| Brown / yellow square | Chest / large chest |
| Cyan diamond | Altar |
| Colored squares | Ground items: healing (green), magnet (pink), bomb (orange), tickets (purple), items (yellow) |

Map background: green = ground, dark = trees/rocks/walls, blue = water (orange for lava).

Bosses, legendaries, shinies, rifts, events, and teammates stay pinned to the map edge when out of range, indicating their direction.

## Co-op

- Each player with the mod sends damage data to the host, who shares it with everyone. The data is included in messages the game already sends; players without the mod ignore it.
- **Best results when the host has the mod.** The host can also see estimated damage for players without the mod, marked with `~`.
- If the host does not have the mod, each player only sees their own damage. Others appear as “no mod.”
- The meter counts direct attack damage. Burn and poison damage over time are excluded from the total; in solo play they appear separately in the attack breakdown.
- Attack breakdown is only shown for you. Teammates' health is visible whether or not they have the mod.
- **Rooms of up to 8 players:** Settings → Extras → Co-op → “Rooms of up to 8 players” (on by default). The game allows 4; the host and everyone joining as player 5-8 need PokeSurvivor Plus 1.2 or later with the option on (players without it can't join a room that already has 4). Players 5-8 get four new colours (orange, violet, teal, white). Enemy spawn rate and health keep growing with each player past 4, more gently than from 1 to 4 (spawn rate ×3.25 at 4 players, ×3.65 at 5, up to ×4.85 at 8; health ×1.9, ×2.05 … ×2.5), and experience per enemy is raised to match the gentler spawn rate, so levelling keeps pace. Runs of 5-8 are never registered with or sent to the leaderboard, and your best time (solo and co-op) is left as it was. In rooms of 5-8 the teammate cards at the top left shrink to one line each.
- **Friends list:** each friend shows what they're doing (online, in a lobby, in a solo or co-op run; refreshed every 30 seconds while the list is open), with a **Join** button for a friend's lobby (not during a run, and not while you have others in your own room). **Anyone in a room can invite friends**, not only the host (their invites are taken back when they leave).
- **Create room:** **Friends → Create room** makes a room without inviting anyone, with a short 6-digit code (e.g. `482 913`) to share. Rooms the game creates when you invite someone keep their long code.
- **Room codes:** **Room code** on the room panel shows the room's code with **Copy code** and **Copy link** (a `pokesurvivor.com/#join=…` link). Anyone with PokeSurvivor Plus and a game account can join with it from **Friends → Room code or link**, or by opening the link (which asks first). The first time, it warns that anyone with the code can join and that players connect directly, so they can see each other's IP address. Useful for streams; hide the code when you don't want more players.
- **Full rooms and removing players:** when every place is taken, the host's PokeSurvivor Plus marks the room full, so joiners are told before knocking (and nobody gets in by mistake). The host can remove a player with the **Kick** button on their card in the party (it asks “Sure?” first); removed players are kept out of that room.
- **Co-op runs:** pick changes on level-up cards until everyone has chosen; everyone picks their bond at the same time after a rift; big chests and revives go faster with more players on them (up to 3×).
- **Rifts:** after a rift, the host waits until everyone is out of the arena before bosses can spawn again, and a boss that ends up thousands of metres from everyone is brought back near the team.

## If you get disconnected

The game connects players directly to each other. If that connection briefly drops (Wi-Fi, network switching, router issues), the original game removes the player without warning. With the mod:

- A “Connection lost with…” alert appears and the mod waits up to 30 seconds. The host retries the connection after 15 seconds. If it returns, keep playing. Otherwise, the host's run continues and the disconnected player is removed as in the original game.
- Enemies may spawn while a player is disconnected and therefore not be visible to them. They cannot damage that player and disappear when defeated.
- Chrome is prevented from discarding the game tab to save memory, a common cause of page reloads.
- If you are still disconnected, press `Alt` + `L` and check the last log line to identify whether the cause was the peer connection, internet, or browser.
- Works best when everyone has the mod, especially the host.

## Notes

- With a wider field of view, enemies can appear farther away because the game spawns them outside the camera. Screen-wide attacks can hit more enemies, but performance may decrease at very wide settings.
- Colour blind mode filters the whole page, so menus and the HUD are corrected too (or only the UI, with **Apply to: UI only**, which draws the HUD on its own layer). Very old or low-end machines may see a small performance cost, a little more with UI only; set it to Off if so.
- The game is obfuscated, and the mod hooks into internal modules (`Camera`, `Net`, `Coop`, `Game`). A game update may change those names and temporarily break the mod.

## Credits

- Pokémon portraits in the HUD are loaded from [PMDCollab SpriteCollab](https://github.com/PMDCollab/SpriteCollab) (CC BY-NC 4.0), the same project the game's sprites come from.
- Tier letters come from [SurvivorTiers](https://survivortiers.pages.dev/en/), a fan-made tier list for PokéSurvivor by [@fildotai](https://x.com/fildotai), read from its public ranking file (`/data/ranking.csv`). It is a separate community site, not affiliated with PokeSurvivor Plus.
- The new music was written for PokeSurvivor Plus in the format of the game's own soundtrack.
