const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'index.html');
const destPath = path.join(__dirname, 'guru.html');

let html = fs.readFileSync(srcPath, 'utf8');

// 1. Remove the "Pengaturan Database" sidebar button
const sidebarButtonRegex = /<button class="menu-item"[^>]*id="btn-menu-github"[\s\S]*?<\/button>/;
html = html.replace(sidebarButtonRegex, '<!-- Pengaturan Database dinonaktifkan untuk guru -->');

// 2. Remove the settings section
const viewSectionRegex = /<section id="view-github" class="content-view">[\s\S]*?<\/section>/;
html = html.replace(viewSectionRegex, '<!-- Pengaturan Database dinonaktifkan untuk guru -->');

fs.writeFileSync(destPath, html, 'utf8');
console.log('guru.html successfully generated!');
