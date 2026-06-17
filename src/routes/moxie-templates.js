/**
 * Moxie HTML template helpers
 * Renders page shells, images, buttons, and shortcuts
 */

export function pageShell(title, body, extraHead = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark;font-family:Cambria,Georgia,'Times New Roman',serif;font-size:17px;background:#080b12;color:#f3f6ff}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:linear-gradient(rgba(4,8,16,.78),rgba(4,8,16,.82)),radial-gradient(circle at 20% 0%,#2a3a66 0,#080b12 42%,#05060a 100%);background-size:cover;background-position:center;background-attachment:fixed}
.wrap{max-width:1040px;margin:0 auto;padding:24px 30px}
.chat-wrap{width:min(1780px,calc(100vw - 36px));max-width:min(1780px,calc(100vw - 36px));height:100vh;display:flex;flex-direction:column;overflow:hidden}
header{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap;flex:0 0 auto}
.brand{font-size:1.6rem;font-weight:800;letter-spacing:.2px}
.brand-with-icon{display:flex;align-items:center;gap:12px}
.brand-with-avatar{display:flex;align-items:center;gap:14px;min-width:min(100%,520px)}
.moxie-avatar{width:174px;aspect-ratio:16/9;border-radius:20px;object-fit:cover;object-position:center;box-shadow:0 14px 42px rgba(0,0,0,.42);flex:0 0 auto;background:#0b1020;border:1px solid #d7bbff66}
.moxie-tagline{max-width:410px}
.log-icon{width:96px;height:54px;border-radius:18px;object-fit:cover;object-position:center;box-shadow:0 10px 30px rgba(0,0,0,.34);flex:0 0 auto;background:#0b1020;border:1px solid #86b2ff33}
.header-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.hint{color:#c1cdeb;font-size:.95rem;line-height:1.45}
a{color:#b9d0ff}
.button-link{display:inline-block;padding:6px 14px;border-radius:11px;background:#26375d;color:#dbe5ff;border:1px solid #4a5e91;text-decoration:none;font-size:.85rem;font-weight:700}
.button-link:hover{background:#314a7a}
.pill{display:inline-block;padding:4px 10px;border-radius:99px;background:#1a2744;color:#9fc0ff;font-size:.75rem;font-weight:800;letter-spacing:.04em;border:1px solid #314472}
.panel{background:rgba(13,18,32,.82);border:1px solid #26375d;border-radius:16px}
.chat-main{display:grid;grid-template-columns:292px minmax(0,920px) 292px;gap:18px;align-items:stretch;justify-content:center;width:100%;flex:1 1 auto;min-height:0}
.chat-panel{width:100%;max-width:920px;justify-self:center;display:flex;flex-direction:column;min-height:0;max-height:100%}
.saved-chats-rail{justify-self:start;width:292px;max-width:292px}
.saved-chats-panel{padding:14px;height:100%;display:flex;flex-direction:column;min-height:0}
.saved-chats-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex:0 0 auto}
.saved-chats-title{font-weight:900;color:#f3f6ff;letter-spacing:.02em}
.saved-chats-list{display:flex;flex-direction:column;gap:8px;max-height:none;overflow:auto;flex:1 1 auto;min-height:0}
.saved-chat-item{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;gap:7px;width:100%;min-height:48px}
.saved-chat-open{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;width:100%;min-height:48px;padding:8px 10px;border:1px solid #314472;border-radius:13px;background:#101a31;color:#eaf0ff;text-align:left;font-weight:800;cursor:pointer}
.saved-chat-open:hover{border-color:#9fc0ff;background:#162544}
.saved-chat-delete{width:38px;min-height:48px;border:1px solid #5b2d37;border-radius:13px;background:#2a1320;color:#ffd5dc;font-size:1.15rem;font-weight:900;cursor:pointer}
.saved-chat-delete:hover{border-color:#ff8fa3;background:#3a1828}
.saved-chat-date{font-size:.76rem;font-weight:700;color:#aebde0}
.empty-saved-chats{color:#aebde0;font-size:.92rem;line-height:1.35;margin:0}
.chat-control-row{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-bottom:1px solid #283a61;background:rgba(8,13,24,.92);flex:0 0 auto}
.clear-chat-button{min-height:34px;padding:0 12px;border-radius:11px;background:#26375d;color:#dbe5ff;border:1px solid #4a5e91;cursor:pointer}
.messages{flex:1 1;overflow-y:auto;padding:18px 14px;display:flex;flex-direction:column;gap:12px;min-height:0}
.msg{padding:12px 16px;border-radius:14px;line-height:1.55;word-break:break-word;position:relative}
.msg.user{background:#162544;border:1px solid #314472;align-self:flex-end;max-width:75%}
.msg.assistant{background:#0d1426;border:1px solid #26375d;align-self:flex-start;max-width:80%}
.msg .message-timestamp{display:block;margin-top:6px;font-size:.72rem;color:#7a8bb5;font-weight:600}
.msg .message-copy-pill{position:absolute;top:8px;right:8px;padding:2px 8px;border-radius:8px;background:#1a2744;color:#9fc0ff;border:1px solid #314472;font-size:.7rem;font-weight:700;cursor:pointer;opacity:0;transition:opacity .15s}
.msg:hover .message-copy-pill{opacity:1}
.msg .message-copy-pill.is-copied{background:#1a3a2a;color:#7dff9e;border-color:#2d6a4f}
.composer{padding:12px 14px;border-top:1px solid #283a61;display:flex;flex-direction:column;gap:8px;flex:0 0 auto}
.composer-main{display:flex;gap:10px}
.composer textarea{flex:1;min-height:44px;max-height:160px;padding:10px 14px;border-radius:13px;border:1px solid #314472;background:#0d1426;color:#f3f6ff;font-family:inherit;font-size:1rem;resize:vertical;line-height:1.45}
.composer textarea:focus{outline:none;border-color:#6a8bff}
.composer button{padding:0 22px;border-radius:13px;border:1px solid #4a5e91;background:#314a7a;color:#f3f6ff;font-weight:800;font-size:1rem;cursor:pointer}
.composer button:hover{background:#3d5a8e}
.composer button:disabled{opacity:.5;cursor:not-allowed}
.chat-tools{display:flex;flex-direction:column;align-items:flex-end;gap:24px;min-height:0;height:100%;padding-top:2px;justify-self:end;width:292px}
.quick-actions-section{width:292px;max-width:292px;display:flex;justify-content:flex-end}
.ops-hub-section{margin-top:auto}
.shortcut-section-title{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.quick-actions-cluster{display:grid;grid-template-columns:repeat(2,132px);gap:18px 16px;align-items:start;justify-content:end;width:292px}
.shortcut-tile{display:block;width:132px;max-width:100%;color:#dbe5ff;text-decoration:none;text-align:center}
.shortcut-title{display:block;margin-top:5px;color:#f3f6ff;font-size:.68rem;line-height:1.08;font-weight:800;text-align:center;text-shadow:0 2px 8px rgba(0,0,0,.9);letter-spacing:.01em}
.image-action-button{position:relative;display:block;width:132px;max-width:100%;aspect-ratio:16/9;min-height:0;padding:0;border-radius:17px;overflow:hidden;background:#0b1020;border:1px solid rgba(134,178,255,.33);box-shadow:0 12px 36px rgba(0,0,0,.38);text-decoration:none;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}
.image-action-button:hover{transform:translateY(-2px);box-shadow:0 16px 44px rgba(0,0,0,.45);border-color:#b9d0ff}
.image-action-button img{width:100%;height:100%;object-fit:cover;display:block}
.chat-modal{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.58)}
.chat-modal[hidden]{display:none!important}
.chat-modal-card{width:min(420px,100%);padding:22px;border-radius:20px;background:#0d1426;border:1px solid #4a5e91;box-shadow:0 30px 100px rgba(0,0,0,.55)}
.chat-modal-card h2{margin:0 0 8px;font-size:1.3rem}
.chat-modal-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}
.chat-modal-actions .cancel-clear-chat{grid-column:1/-1}
.login,.settings{max-width:520px;margin:8vh auto;padding:26px}
.login input,.settings input{margin:7px 0 13px;padding:10px 14px;border-radius:11px;border:1px solid #314472;background:#0d1426;color:#f3f6ff;font-size:1rem;width:100%;font-family:inherit}
.login input:focus,.settings input:focus{outline:none;border-color:#6a8bff}
.login button,.settings button{padding:10px 22px;border-radius:11px;border:1px solid #4a5e91;background:#314a7a;color:#f3f6ff;font-weight:800;font-size:1rem;cursor:pointer;font-family:inherit}
.login button:hover,.settings button:hover{background:#3d5a8e}
.log-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:18px}
.log-card{background:#0b1020;border:1px solid #26375d;border-radius:14px;padding:16px}
.log-card h3{margin:0 0 10px;font-size:1.1rem}
.log-card textarea{width:100%;min-height:80px;padding:10px;border-radius:10px;border:1px solid #314472;background:#0d1426;color:#f3f6ff;font-family:inherit;font-size:.95rem;resize:vertical}
.log-card textarea:focus{outline:none;border-color:#6a8bff}
.log-card input[type=text]{width:100%;margin-top:8px;padding:8px;border-radius:8px;border:1px solid #314472;background:#0d1426;color:#f3f6ff;font-family:inherit}
.log-card button{margin-top:8px;padding:8px 16px;border-radius:10px;border:1px solid #4a5e91;background:#26375d;color:#dbe5ff;font-weight:700;cursor:pointer;font-family:inherit}
.log-card button:hover{background:#314a7a}
.log-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}
.log-item{background:#0d1426;border:1px solid #26375d;border-radius:12px;padding:12px}
.log-item .log-meta{font-size:.75rem;color:#7a8bb5;margin-top:6px}
.log-item .log-actions{display:flex;gap:8px;margin-top:8px}
.log-item .log-actions button{padding:4px 10px;font-size:.75rem;border-radius:8px;border:1px solid #314472;background:#162544;color:#dbe5ff;cursor:pointer;font-family:inherit}
.log-item .log-actions button:hover{background:#1e3358}
.contacts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;padding:18px}
.contact-card{background:#0b1020;border:1px solid #26375d;border-radius:14px;padding:14px}
.contact-card .contact-name{font-weight:800;font-size:1.05rem;margin-bottom:4px}
.contact-card .contact-detail{font-size:.85rem;color:#c1cdeb;margin:2px 0}
.contact-form{padding:18px;display:flex;flex-direction:column;gap:10px}
.contact-form input{padding:10px;border-radius:10px;border:1px solid #314472;background:#0d1426;color:#f3f6ff;font-size:.95rem;font-family:inherit}
.contact-form button{padding:10px 20px;border-radius:10px;border:1px solid #4a5e91;background:#26375d;color:#dbe5ff;font-weight:700;cursor:pointer;align-self:flex-start;font-family:inherit}
@media(max-width:1200px){.chat-main{grid-template-columns:1fr}.saved-chats-rail,.chat-tools{display:none}}
@media(max-width:700px){.wrap{padding:12px}.chat-wrap{width:100%;max-width:100%}.log-grid,.contacts-grid{grid-template-columns:1fr}}
${extraHead}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function loginPage(err = false) {
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

export function logIconImg() { return iconImg("frog-on-log-writing-pad.png", "Annie's Log"); }
export function reminderIconImg() { return iconImg("reminders-woodland-animal.png", "Reminders"); }
export function contactsIconImg() { return iconImg("contacts-creekside-animal.png", "Contacts"); }
export function settingsIconImg() { return iconImg("settings-woodland-cog.png", "Settings"); }
export function moxieAvatarImg() { return `<img class="moxie-avatar" src="/moxie/assets/moxie-avatar.jpg" alt="Moxie" onerror="this.style.display='none'>`; }

function iconImg(file, alt) {
  return `<img class="log-icon" src="/moxie/assets/${file}" alt="${esc(alt)}" onerror="this.style.display='none'>`;
}

function shortcutTile(href, iconFile, label) {
  return `<a class="shortcut-tile" href="${esc(href)}"><span class="image-action-button"><img src="/moxie/assets/${iconFile}" alt="" onerror="this.parentElement.style.background='#162544'"></span><span class="shortcut-title">${esc(label)}</span></a>`;
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
  return items.map(i => shortcutTile(i.href, i.icon, i.label)).join("\n");
}
