/**
 * @file help.ts
 * @description Dynamic CLI help menu formatter and aligner for Serverfull mode.
 */

/**
 * Item representing a CLI command, option, or setting in the help menu.
 */
export interface HelpItem {
  label: string;
  desc: string;
}

/**
 * Configuration options for rendering a formatted CLI help menu.
 */
export interface HelpMenuConfig {
  name: string;
  description: string;
  usage: string | string[];
  commands?: HelpItem[];
  options?: HelpItem[];
  services?: HelpItem[];
  envVars?: HelpItem[];
}

/**
 * Formats a structured CLI help menu with dynamic column alignment.
 *
 * @param config - The help menu configuration structure.
 * @returns Formatted help menu string ready for console output.
 */
export function formatHelpMenu(config: HelpMenuConfig): string {
  const { name, description, usage, commands, options, services, envVars } = config;
  const indent = '  ';
  const gap = 4; // Space between label column and description column

  // Shared alignment width for commands and options if both exist
  const cmdAndOptItems = [...(commands || []), ...(options || [])];
  const cmdAndOptWidth = Math.max(...cmdAndOptItems.map((item) => item.label.length), 0);

  const renderSection = (title: string, items?: HelpItem[], customWidth?: number): string => {
    if (!items || items.length === 0) return '';
    const width = customWidth ?? Math.max(...items.map((item) => item.label.length), 0);
    const lines = items.map(
      (item) => `${indent}${item.label.padEnd(width + gap)}${item.desc}`
    );
    return `\n${title}:\n${lines.join('\n')}`;
  };

  const usageText = Array.isArray(usage)
    ? usage.map((u) => `${indent}${u}`).join('\n')
    : `${indent}${usage}`;

  const sections = [
    `${name} - ${description}`,
    `\nUsage:\n${usageText}`,
    renderSection('Commands', commands, cmdAndOptWidth),
    renderSection('Options', options, cmdAndOptWidth),
    renderSection('Current Service Ports', services),
    renderSection('Environment Variables', envVars)
  ];

  return sections.filter(Boolean).join('\n') + '\n';
}
