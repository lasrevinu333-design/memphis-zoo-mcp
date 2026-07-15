from pathlib import Path

path = Path("src/routes/moxie-templates.js")
text = path.read_text(encoding="utf-8")

replacements = [
    (
'''export function loginPage(err = false) {
  return pageShell("Moxie — Sign In", `
<div class="wrap"><div class="panel login">
  <div class="brand" style="margin-bottom:18px">Moxie</div>
  <div class="hint" style="margin-bottom:18px">Annie's private work assistant</div>
  ${err ? '<div style="color:#ff8fa3;margin-bottom:12px;font-weight:700">Wrong password. Try again.</div>' : ""}
  <form method="post" action="/moxie/login">
    <label for="password" class="hint">Password</label>
    <input type="password" id="password" name="password" required autofocus>
    <button type="submit">Sign in</button>
  </form>
</div></div>`);
}
''',
'''export function loginPage(err = false, prefix = "/moxie") {
  return pageShell("Moxie — Sign In", `
<div class="wrap"><div class="panel login">
  <div class="brand" style="margin-bottom:18px">Moxie</div>
  <div class="hint" style="margin-bottom:18px">Annie's private work assistant</div>
  ${err ? '<div style="color:#ff8fa3;margin-bottom:12px;font-weight:700">Wrong password. Try again.</div>' : ""}
  <form method="post" action="${esc(`${String(prefix || "").replace(/\\/+$/, "")}/login` || "/login")}">
    <label for="password" class="hint">Password</label>
    <input type="password" id="password" name="password" required autofocus>
    <button type="submit">Sign in</button>
  </form>
</div></div>`);
}
'''
    ),
    (
'''function iconImg(file, alt) {
  const src = _iconDataUris[file] || `/moxie/assets/${file}`;
  return `<img class="log-icon" src="${src}" alt="${esc(alt)}" onerror="this.style.display='none'">`;
}

function shortcutTile(href, iconFile, label) {
  const src = _iconDataUris[iconFile] || `/moxie/assets/${iconFile}`;
  return `<a class="shortcut-tile" href="${esc(href)}"><span class="image-action-button"><img src="${src}" alt="" onerror="this.parentElement.style.background='#162544'"></span><span class="shortcut-title">${esc(label)}</span></a>`;
}

export function logButtonLink() { return shortcutTile("/moxie/log", "frog-on-log-writing-pad.png", "Annie's Log"); }
export function reminderButtonLink() { return shortcutTile("/moxie/reminders", "reminders-woodland-animal.png", "Reminders"); }
export function contactsButtonLink() { return shortcutTile("/moxie/contacts", "contacts-creekside-animal.png", "Contacts"); }
export function settingsButtonLink() { return shortcutTile("/moxie/password", "settings-woodland-cog.png", "Settings"); }

export function opsHubButtons() {
  const items = [
    { href: "/dashboard", icon: "ops-dashboard.png", label: "Dashboard" },
    { href: "/schedule", icon: "ops-schedule.png", label: "Schedule" },
    { href: "/events-admin", icon: "ops-events.png", label: "Events" },
    { href: "/messaging", icon: "ops-messaging.png", label: "Messaging" },
  ];
  return items.map(i => shortcutTile(i.href, i.icon, i.label)).join("\\n");
}
''',
'''function iconImg(file, alt, prefix = "/moxie") {
  const base = String(prefix || "").replace(/\\/+$/, "");
  const src = _iconDataUris[file] || `${base}/assets/${file}`;
  return `<img class="log-icon" src="${src}" alt="${esc(alt)}" onerror="this.style.display='none'">`;
}

function shortcutTile(href, iconFile, label, prefix = "/moxie") {
  const base = String(prefix || "").replace(/\\/+$/, "");
  const src = _iconDataUris[iconFile] || `${base}/assets/${iconFile}`;
  return `<a class="shortcut-tile" href="${esc(href)}"><span class="image-action-button"><img src="${src}" alt="" onerror="this.parentElement.style.background='#162544'"></span><span class="shortcut-title">${esc(label)}</span></a>`;
}

export function logButtonLink(prefix = "/moxie") { const base=String(prefix||"").replace(/\\/+$/, ""); return shortcutTile(`${base}/log`, "frog-on-log-writing-pad.png", "Annie's Log", base); }
export function reminderButtonLink(prefix = "/moxie") { const base=String(prefix||"").replace(/\\/+$/, ""); return shortcutTile(`${base}/reminders`, "reminders-woodland-animal.png", "Reminders", base); }
export function contactsButtonLink(prefix = "/moxie") { const base=String(prefix||"").replace(/\\/+$/, ""); return shortcutTile(`${base}/contacts`, "contacts-creekside-animal.png", "Contacts", base); }
export function settingsButtonLink(prefix = "/moxie") { const base=String(prefix||"").replace(/\\/+$/, ""); return shortcutTile(`${base}/password`, "settings-woodland-cog.png", "Settings", base); }

export function opsHubButtons() {
  const base = "https://lasrevinu333-design.github.io/Engine";
  const items = [
    { href: `${base}/dashboard.html`, icon: "ops-dashboard.png", label: "Dashboard" },
    { href: `${base}/schedule-simple.html`, icon: "ops-schedule.png", label: "Schedule" },
    { href: `${base}/events-admin.html`, icon: "ops-events.png", label: "Events" },
    { href: `${base}/messages.html?hub=manager`, icon: "ops-messaging.png", label: "Messaging" },
    { href: `${base}/ops-manager-hub.html`, icon: "settings-woodland-cog.png", label: "Ops Hub" },
  ];
  return items.map(i => shortcutTile(i.href, i.icon, i.label)).join("\\n");
}
'''
    ),
]

for index, (old, new) in enumerate(replacements, start=1):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Moxie template patch anchor {index} expected once, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print("MOXIE_TEMPLATE_PATCH_PASS")
