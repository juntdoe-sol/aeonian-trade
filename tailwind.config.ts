import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config = {
  darkMode: ['class', 'class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
  	container: {
  		center: true,
  		padding: {
  			DEFAULT: '1rem',
  			sm: '1.5rem',
  		},
  	},
  	extend: {
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			link: {
  				DEFAULT: 'hsl(var(--link))',
  				hover: 'hsl(var(--link-hover))'
  			},
  			button: {
  				DEFAULT: 'hsl(var(--button))',
  				foreground: 'hsl(var(--button-foreground))',
  				border: 'hsl(var(--button-border))',
  				hover: 'hsl(var(--button-hover))',
  				'hover-foreground': 'hsl(var(--button-hover-foreground))',
  				'hover-border': 'hsl(var(--button-hover-border))',
  				ring: 'hsl(var(--button-ring))'
  			},
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: { height: '0' },
  				to: { height: 'var(--radix-accordion-content-height)' }
  			},
  			'accordion-up': {
  				from: { height: 'var(--radix-accordion-content-height)' },
  				to: { height: '0' }
  			},
  			'fade-in': {
  				from: { opacity: '0' },
  				to: { opacity: '1' }
  			},
  			'fade-in-up': {
  				from: { opacity: '0', transform: 'translateY(12px)' },
  				to: { opacity: '1', transform: 'translateY(0)' }
  			},
  			'fade-in-down': {
  				from: { opacity: '0', transform: 'translateY(-12px)' },
  				to: { opacity: '1', transform: 'translateY(0)' }
  			},
  			'scale-in': {
  				from: { opacity: '0', transform: 'scale(0.95)' },
  				to: { opacity: '1', transform: 'scale(1)' }
  			},
  			'slide-in-left': {
  				from: { opacity: '0', transform: 'translateX(-16px)' },
  				to: { opacity: '1', transform: 'translateX(0)' }
  			},
  			'slide-in-right': {
  				from: { opacity: '0', transform: 'translateX(16px)' },
  				to: { opacity: '1', transform: 'translateX(0)' }
  			},
  			shimmer: {
  				from: { backgroundPosition: '-200% 0' },
  				to: { backgroundPosition: '200% 0' }
  			},
  			'pulse-glow': {
  				'0%, 100%': { opacity: '0.6' },
  				'50%': { opacity: '1' }
  			},
  			meteor: {
  				'0%': { transform: 'rotate(215deg) translateX(0)', opacity: '1' },
  				'70%': { opacity: '1' },
  				'100%': { transform: 'rotate(215deg) translateX(-500px)', opacity: '0' }
  			},
  			spotlight: {
  				'0%': { opacity: '0', transform: 'translate(-72%, -62%) scale(0.5)' },
  				'100%': { opacity: '1', transform: 'translate(-50%,-40%) scale(1)' }
  			},
  			aurora: {
  				'0%': { backgroundPosition: '0% 50%' },
  				'50%': { backgroundPosition: '100% 50%' },
  				'100%': { backgroundPosition: '0% 50%' }
  			},
  			shine: {
  				'0%': { backgroundPosition: '0% 0%' },
  				'50%': { backgroundPosition: '100% 100%' },
  				'100%': { backgroundPosition: '0% 0%' }
  			},
  			ripple: {
  				'0%, 100%': { transform: 'translate(-50%, -50%) scale(1)' },
  				'50%': { transform: 'translate(-50%, -50%) scale(1.1)' }
  			},
  			marquee: {
  				from: { transform: 'translateX(0)' },
  				to: { transform: 'translateX(calc(-100% - var(--gap)))' }
  			},
  			'marquee-vertical': {
  				from: { transform: 'translateY(0)' },
  				to: { transform: 'translateY(calc(-100% - var(--gap)))' }
  			},
  			grid: {
  				'0%': { transform: 'translateY(-50%)' },
  				'100%': { transform: 'translateY(0)' }
  			},
  			'shiny-text': {
  				'0%, 90%, 100%': { backgroundPosition: 'calc(-100% - var(--shiny-width)) 0' },
  				'30%, 60%': { backgroundPosition: 'calc(100% + var(--shiny-width)) 0' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'fade-in': 'fade-in 0.5s ease-out both',
  			'fade-in-up': 'fade-in-up 0.5s ease-out both',
  			'fade-in-down': 'fade-in-down 0.5s ease-out both',
  			'scale-in': 'scale-in 0.4s ease-out both',
  			'slide-in-left': 'slide-in-left 0.5s ease-out both',
  			'slide-in-right': 'slide-in-right 0.5s ease-out both',
  			shimmer: 'shimmer 2.5s ease-in-out infinite',
  			'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
  			meteor: 'meteor 5s linear infinite',
  			spotlight: 'spotlight 2s ease 0.75s 1 forwards',
  			aurora: 'aurora 8s ease-in-out infinite',
  			shine: 'shine 14s infinite linear',
  			ripple: 'ripple 3.5s ease-in-out infinite',
  			marquee: 'marquee var(--duration) linear infinite',
  			'marquee-vertical': 'marquee-vertical var(--duration) linear infinite',
  			grid: 'grid 15s linear infinite',
  			'shiny-text': 'shiny-text 8s infinite'
  		}
  	}
  },
  plugins: [animate],
} satisfies Config;

export default config;
