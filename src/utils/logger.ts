const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

export const logger = {
  info(msg: string) {
    console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`);
  },
  success(msg: string) {
    console.log(`${colors.green}✓${colors.reset} ${msg}`);
  },
  warn(msg: string) {
    console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
  },
  error(msg: string) {
    console.error(`${colors.red}✗${colors.reset} ${msg}`);
  },
  step(step: number, total: number, msg: string) {
    console.log(`${colors.magenta}[${step}/${total}]${colors.reset} ${msg}`);
  },
  dim(msg: string) {
    console.log(`${colors.gray}  ${msg}${colors.reset}`);
  },
  banner() {
    console.log(`
${colors.bright}${colors.cyan}╔═══════════════════════════════════════╗
║           🔬 C L O N A G E           ║
║     Website Cloner for Learning      ║
╚═══════════════════════════════════════╝${colors.reset}
`);
  },
};
