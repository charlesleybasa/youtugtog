const fs = require('fs');
const audit = JSON.parse(fs.readFileSync('audit-results.json', 'utf8'));

let markdown = '# Dependency Security Scan Report\n\n';
markdown += '> [!WARNING]\n> Multiple vulnerabilities found in dependencies.\n\n';

const severities = { low: 0, moderate: 0, high: 0, critical: 0 };
let total = 0;
const modules = new Set();

const advisories = audit.advisories || {};
for (const id in advisories) {
  const adv = advisories[id];
  severities[adv.severity] = (severities[adv.severity] || 0) + 1;
  total++;
  modules.add(adv.module_name);
}

markdown += `**Total Vulnerabilities:** ${total}\n`;
markdown += `- Critical: ${severities.critical}\n`;
markdown += `- High: ${severities.high}\n`;
markdown += `- Moderate: ${severities.moderate}\n`;
markdown += `- Low: ${severities.low}\n\n`;

markdown += `**Affected Modules:** ${Array.from(modules).join(', ')}\n\n`;
markdown += '---\n\n## Vulnerability Details\n\n';

for (const id in advisories) {
  const adv = advisories[id];
  markdown += `### ${adv.title}\n`;
  markdown += `- **Package:** \`${adv.module_name}\`\n`;
  markdown += `- **Severity:** ${adv.severity}\n`;
  markdown += `- **Vulnerable Versions:** ${adv.vulnerable_versions}\n`;
  markdown += `- **Patched In:** ${adv.patched_versions}\n`;
  if (adv.cves && adv.cves.length) {
    markdown += `- **CVEs:** ${adv.cves.join(', ')}\n`;
  }
  markdown += `- [More Info](${adv.url})\n\n`;
}

fs.writeFileSync('/Users/rli/.gemini/antigravity-ide/brain/af70534d-0434-498c-8c5e-5f488007f3ad/security_scan_report.md', markdown);
