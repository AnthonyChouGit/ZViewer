const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const helper = path.join(__dirname, 'cli-settings-origin.go');
const embeddedCss = path.join(__dirname, 'cli-desktop-embedded.css');
const embeddedJs = path.join(__dirname, 'cli-desktop-embedded.js');
const anchor = '\t\tHandler: handler,';
const replacement = '\t\tHandler: desktopProtectCLISettings(handler, a.port),';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function patchInfo() {
  const files = [__filename, helper, embeddedCss, embeddedJs].map(file => ({file:path.basename(file),sha256:sha256(fs.readFileSync(file))}));
  return {name:'local-settings-origin-and-host-and-embedded-theme',sha256:sha256(Buffer.from(JSON.stringify(files))),files};
}

function applyCliPatch(source, destination) {
  fs.mkdirSync(destination,{recursive:true});
  for (const entry of fs.readdirSync(source,{withFileTypes:true})) {
    if (!entry.isFile()) throw new Error('Unexpected directory in pinned CLI source cache');
    if (entry.name.startsWith('third-party-license-')) continue;
    fs.copyFileSync(path.join(source,entry.name),path.join(destination,entry.name));
  }
  const server = path.join(destination,'server.go');
  const original = fs.readFileSync(server,'utf8');
  if(original.split(anchor).length !== 2) throw new Error('Pinned CLI settings patch anchor mismatch');
  fs.writeFileSync(server,original.replace(anchor,replacement));
  fs.copyFileSync(helper,path.join(destination,'desktop_settings_origin.go'));
  const page = path.join(destination,'page.go');
  const pageOriginal = fs.readFileSync(page,'utf8');
  const styleAnchor = '  </style>';
  const paramsAnchor = "    const params = new URLSearchParams(location.search)";
  if(pageOriginal.split(styleAnchor).length !== 2 || pageOriginal.split(paramsAnchor).length !== 2) throw new Error('Pinned CLI desktop theme patch anchor mismatch');
  const themedPage = pageOriginal.replace(styleAnchor,fs.readFileSync(embeddedCss,'utf8')+'\n'+styleAnchor)
    .replace(paramsAnchor,paramsAnchor+'\n'+fs.readFileSync(embeddedJs,'utf8'));
  fs.writeFileSync(page,themedPage);
  return patchInfo();
}

module.exports = {applyCliPatch,patchInfo};
