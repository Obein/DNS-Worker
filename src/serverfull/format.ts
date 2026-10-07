/**
 * @file format.ts
 * @description Declarative CLI formatters for menus, banners, diagnostic notices, and service summaries.
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
  tip?: string | string[];
}

/**
 * Formats a declarative tip block with indentation.
 *
 * @param tip - Tip string or array of tip strings.
 * @param indent - Left indentation string (default: '  ').
 * @returns Formatted tip string.
 */
export function formatTip(tip: string | string[], indent: string = '  '): string {
  if (!tip) return '';
  const lines = Array.isArray(tip)
    ? tip.map((t) => `${indent}${t}`).join('\n')
    : `${indent}${tip}`;
  return `\nTip:\n${lines}\n`;
}

/**
 * Formats a structured CLI help menu with dynamic column alignment.
 *
 * @param config - The help menu configuration structure.
 * @returns Formatted help menu string ready for console output.
 */
export function formatHelpMenu(config: HelpMenuConfig): string {
  const { name, description, usage, commands, options, services, envVars, tip } = config;
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

  const tipText = tip ? formatTip(tip, indent).trimEnd() : '';

  const sections = [
    `${name} - ${description}`,
    `\nUsage:\n${usageText}`,
    renderSection('Commands', commands, cmdAndOptWidth),
    renderSection('Options', options, cmdAndOptWidth),
    renderSection('Current Service Ports', services),
    renderSection('Environment Variables', envVars),
    tipText
  ];

  return sections.filter(Boolean).join('\n') + '\n';
}

/**
 * Item representing a CLI command and its description.
 */
export interface CommandItem {
  command: string;
  desc: string;
}

/**
 * Configuration options for rendering a declarative command list.
 */
export interface CommandListConfig {
  title?: string;
  items: CommandItem[];
  indent?: string;
  gap?: number;
}

/**
 * Formats a list of commands with dynamic column alignment.
 *
 * @param config - The command list configuration.
 * @returns Formatted multi-line string with aligned commands and descriptions.
 */
export function formatCommandList(config: CommandListConfig): string {
  const { title, items, indent = '  ', gap = 4 } = config;
  if (!items || items.length === 0) return '';

  const maxCmdWidth = Math.max(...items.map((i) => i.command.length), 0);
  const lines = items.map(
    (item) => `${indent}${item.command.padEnd(maxCmdWidth + gap)}# ${item.desc}`
  );

  if (title) {
    return `${title}\n${lines.join('\n')}\n`;
  }
  return lines.join('\n') + '\n';
}

/**
 * Configuration options for rendering a bordered content or log preview box.
 */
export interface LogBoxConfig {
  title: string;
  content: string;
  borderChar?: '-' | '=' | '#' | '*';
  minWidth?: number;
  tip?: string;
}

/**
 * Formats a declarative bordered content or log viewer block with title and optional tip.
 *
 * @param config - The log box configuration.
 * @returns Formatted log box string.
 */
export function formatLogBox(config: LogBoxConfig): string {
  const { title, content, borderChar = '-', minWidth = 60, tip } = config;
  const headerText = `[${title}]`;
  const borderLength = Math.max(minWidth, headerText.length + 8);
  const border = borderChar.repeat(borderLength);

  const leftPad = 3;
  const rightPad = Math.max(3, borderLength - headerText.length - leftPad - 2);
  const header = `${borderChar.repeat(leftPad)} ${headerText} ${borderChar.repeat(rightPad)}`;

  const lines: string[] = [
    header,
    content,
    border
  ];

  if (tip) {
    lines.push(`Tip: ${tip}`);
  }

  return '\n' + lines.join('\n') + '\n';
}

/**
 * Key-value item for structured output sections.
 */
export interface KeyValueItem {
  label: string;
  value: string;
}

/**
 * Configuration options for rendering a formatted key-value section.
 */
export interface KeyValueSectionConfig {
  title?: string;
  bullet?: string;
  items: KeyValueItem[];
  indent?: string;
  gap?: number;
}

/**
 * Formats a key-value list with dynamic alignment between labels and values.
 *
 * @param config - The key-value section configuration.
 * @returns Formatted multi-line string with aligned columns.
 */
export function formatKeyValueSection(config: KeyValueSectionConfig): string {
  const { title, bullet = '• ', items, indent = '  ', gap = 2 } = config;
  if (!items || items.length === 0) return '';

  const maxLabelWidth = Math.max(...items.map((item) => item.label.length), 0);
  const lines = items.map(
    (item) => `${indent}${bullet}${item.label.padEnd(maxLabelWidth + gap)}:  ${item.value}`
  );

  if (title) {
    return `${title}\n${lines.join('\n')}`;
  }
  return lines.join('\n');
}

/**
 * Item displayed inside a banner card.
 */
export interface BannerItem {
  label: string;
  value: string;
}

/**
 * Configuration options for rendering an ASCII banner or card.
 */
export interface BannerConfig {
  title: string;
  subtitle?: string;
  borderChar?: '-' | '=' | '#' | '*';
  bullet?: string;
  minWidth?: number;
  items?: BannerItem[];
}

/**
 * Formats a declarative bordered banner with optional centered title and aligned key-values.
 *
 * @param config - The banner configuration.
 * @returns Formatted banner string ready for console display.
 */
export function formatBanner(config: BannerConfig): string {
  const { title, subtitle, borderChar = '-', bullet = '• ', minWidth = 54, items } = config;

  // Determine ideal banner width
  const contentLengths = [
    title.length + 6,
    subtitle ? subtitle.length + 6 : 0,
    ...(items || []).map((i) => i.label.length + i.value.length + 10)
  ];
  const calculatedWidth = Math.max(minWidth, ...contentLengths);
  const border = borderChar.repeat(calculatedWidth);

  const centerText = (text: string): string => {
    const pad = Math.max(0, Math.floor((calculatedWidth - text.length) / 2));
    return ' '.repeat(pad) + text;
  };

  const lines: string[] = [border, centerText(title)];

  if (subtitle) {
    lines.push(centerText(subtitle));
  }

  lines.push(border);

  if (items && items.length > 0) {
    const maxLabelWidth = Math.max(...items.map((item) => item.label.length), 0);
    const itemLines = items.map(
      (item) => `  ${bullet}${item.label.padEnd(maxLabelWidth + 2)}:  ${item.value}`
    );
    lines.push(...itemLines);
    lines.push(border);
  }

  return lines.join('\n');
}

/**
 * Severity level for diagnostic messages.
 */
export type DiagnosticLevel = 'error' | 'warning' | 'info' | 'success';

/**
 * Configuration options for rendering a structured diagnostic or alert message.
 */
export interface DiagnosticConfig {
  level?: DiagnosticLevel;
  title: string;
  message: string;
  details?: string[];
  causes?: string[];
  solutions?: string[];
}

/**
 * Formats a structured diagnostic notice with causes, solutions, and details.
 *
 * @param config - Diagnostic configuration options.
 * @returns Formatted diagnostic message string.
 */
export function formatDiagnostic(config: DiagnosticConfig): string {
  const { title, message, details, causes, solutions } = config;
  const indent = '  ';
  const subIndent = '    ';

  const sections: string[] = [
    `[${title}] ${message}`
  ];

  if (details && details.length > 0) {
    sections.push(details.map((d) => `${indent}${d}`).join('\n'));
  }

  if (causes && causes.length > 0) {
    const causesHeader = `${indent}Possible causes:`;
    const causeLines = causes.map((c) => `${subIndent}- ${c}`).join('\n');
    sections.push(`${causesHeader}\n${causeLines}`);
  }

  if (solutions && solutions.length > 0) {
    const solHeader = solutions.length === 1 ? `${indent}Solution:` : `${indent}Solutions:`;
    const solLines = solutions.map((s) => `${subIndent}- ${s}`).join('\n');
    sections.push(`${solHeader}\n${solLines}`);
  }

  return '\n' + sections.filter(Boolean).join('\n') + '\n';
}

/**
 * Configuration options for rendering a network socket or port startup error.
 */
export interface PortErrorConfig {
  serviceName: string;
  protocol: 'UDP' | 'DoT' | 'HTTP' | string;
  port: number;
  err: unknown;
  alternateOption: string;
  disableOption?: string;
}

/**
 * Formats a declarative diagnostic message for port conflicts (EADDRINUSE) and permissions (EACCES).
 *
 * @param config - Port error configuration.
 * @returns Formatted diagnostic string.
 */
export function formatPortError(config: PortErrorConfig): string {
  const { serviceName, protocol, port, err, alternateOption, disableOption } = config;
  const errCode = (err as { code?: string })?.code;

  if (errCode === 'EADDRINUSE') {
    const causes: string[] = [];
    if (protocol === 'UDP' && port === 53) {
      causes.push('Linux: systemd-resolved is listening on port 53 (stop it or configure DNSStubListener=no).');
      causes.push('Another DNS server (bind9, dnsmasq, AdGuard Home) is running.');
    } else {
      causes.push(`Another service or application is already listening on ${protocol} port ${port}.`);
    }

    const solutions = [
      `Use ${alternateOption} to specify an alternate port.`,
      disableOption ? `Or use ${disableOption} to disable this transport.` : null
    ].filter(Boolean) as string[];

    return formatDiagnostic({
      level: 'error',
      title: 'Port Conflict',
      message: `${serviceName} port ${port} is already in use.`,
      causes,
      solutions
    });
  }

  if (errCode === 'EACCES') {
    const causes = [
      'Port numbers below 1024 require elevated privileges on Linux/macOS.',
      'On Windows, the port may fall within a reserved NAT/Hyper-V port exclusion range.'
    ];

    const solutions = [
      'Run with elevated privileges (e.g. sudo npx dns-worker).',
      `Or use ${alternateOption} to bind to an unprivileged or available port.`
    ];

    return formatDiagnostic({
      level: 'error',
      title: 'Permission Denied',
      message: `Permission denied binding to ${serviceName} port ${port}.`,
      causes,
      solutions
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  return `\n[${serviceName}] Startup Error: ${message}\n`;
}
