declare const config: {
  darkMode: ['class', string];
  content: string[];
  theme: {
    extend: {
      colors: {
        border: string;
        input: string;
        ring: string;
        background: string;
        foreground: string;
        primary: {
          DEFAULT: string;
          foreground: string;
        };
        secondary: {
          DEFAULT: string;
          foreground: string;
        };
        destructive: {
          DEFAULT: string;
          foreground: string;
        };
        muted: {
          DEFAULT: string;
          foreground: string;
        };
        accent: {
          DEFAULT: string;
          foreground: string;
        };
        popover: {
          DEFAULT: string;
          foreground: string;
        };
        card: {
          DEFAULT: string;
          foreground: string;
        };
        chart: {
          '1': string;
          '2': string;
          '3': string;
          '4': string;
          '5': string;
        };
        sidebar: {
          DEFAULT: string;
          foreground: string;
          primary: string;
          'primary-foreground': string;
          accent: string;
          'accent-foreground': string;
          border: string;
          ring: string;
        };
      };
      borderRadius: {
        lg: string;
        md: string;
        sm: string;
      };
      keyframes: {
        'accordion-down': {
          from: {
            height: string;
          };
          to: {
            height: string;
          };
        };
        'accordion-up': {
          from: {
            height: string;
          };
          to: {
            height: string;
          };
        };
      };
      animation: {
        'accordion-down': string;
        'accordion-up': string;
      };
    };
  };
  plugins: {
    handler: () => void;
  }[];
};
export default config;
