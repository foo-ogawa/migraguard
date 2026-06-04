import packageJson from '../package.json' with { type: 'json' };

export const pkg = packageJson as {
  name: string;
  version: string;
  description: string;
};

export const VERSION: string = pkg.version;
