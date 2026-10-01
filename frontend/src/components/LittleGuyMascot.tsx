import { useId } from 'react';
import type { MascotRecipe } from '@/lib/types';

export const defaultMascot: MascotRecipe = { body: 'gpu', eyes: 'round', mouth: 'tiny', accessory: 'none', pattern: 'plain', palette: 'lavender', seed: 42 };
const colors = { lavender: ['#c39af3', '#e2d3ff'], amethyst: ['#a883da', '#c7a7fa'], moonlight: ['#b7badc', '#e4e5ff'], teal: ['#68bdcb', '#b6e6ee'], rose: ['#ce9bca', '#efc5e5'] };
const shapes = {
  flame: 'M100 30 C136 63 117 85 145 61 C178 118 169 168 100 172 C42 168 25 123 67 73 C69 103 92 92 100 30 Z',
  blob: 'M52 73 C47 35 91 34 112 53 C154 35 177 75 166 106 C190 151 147 177 110 165 C63 188 22 149 40 118 C23 94 34 80 52 73 Z',
  star: 'M100 31 L115 60 L145 48 L145 81 L177 88 L154 111 L173 139 L140 145 L132 175 L104 158 L80 179 L69 149 L36 150 L49 122 L24 100 L55 88 L53 56 L84 65 Z',
};
function tint(hex: string, seed: number) {
  const n = parseInt(hex.slice(1), 16), delta = (seed % 15) - 7;
  return `rgb(${[n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, v + delta))).join(' ')})`;
}

export default function LittleGuyMascot({ recipe = defaultMascot, size = 96, label = 'Little guy', animated = true }: { recipe?: MascotRecipe; size?: number; label?: string; animated?: boolean }) {
  const id = useId().replace(/:/g, ''), palette = colors[recipe.palette] || colors.lavender;
  const main = tint(palette[0], recipe.seed), light = palette[1], dark = '#21162f';
  const body = recipe.body === 'gpu' ? <rect x="36" y="71" width="128" height="83" rx="13" />
    : recipe.body === 'robot' ? <rect x="48" y="59" width="105" height="105" rx="25" />
    : <path d={recipe.body === 'flame' ? 'M100 30 C136 63 117 85 145 61 C178 118 169 168 100 172 C42 168 25 123 67 73 C69 103 92 92 100 30 Z' : shapes[recipe.body]} />;
  const eyeY = recipe.body === 'gpu' ? 106 : 107;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox="0 0 200 200" className={`flex-none overflow-visible ${animated ? 'little-guy-bob' : ''}`}>
      <defs><clipPath id={`body-${id}`}>{body}</clipPath></defs>
      <ellipse cx="101" cy="186" rx="43" ry="6" fill={main} opacity=".1" />
      <g fill="none" stroke={light} strokeWidth="5" strokeLinecap="round">
        <path d="M72 149 L66 176 L54 176 M128 149 L135 176 L148 176 M40 112 L24 101 M160 112 L178 99" />
      </g>
      <g fill={main} stroke={dark} strokeWidth="4" strokeLinejoin="round">{body}</g>
      <g clipPath={`url(#body-${id})`} fill={light} opacity=".25">
        {recipe.pattern === 'stripes' && Array.from({ length: 5 }, (_, i) => <path key={i} d={`M${30 + i * 35} 35 l-65 145 h12 l65-145z`} />)}
        {['spots', 'freckles'].includes(recipe.pattern) && Array.from({ length: recipe.pattern === 'spots' ? 7 : 18 }, (_, i) => <circle key={i} cx={43 + ((i * 37 + recipe.seed) % 113)} cy={55 + ((i * 29 + recipe.seed) % 101)} r={recipe.pattern === 'spots' ? 7 : 2} />)}
      </g>
      {recipe.body === 'gpu' && <g fill={light} stroke={dark} strokeWidth="3">{[70, 130].map(x => <g key={x}><circle cx={x} cy="109" r="22" />{[0, 60, 120].map(a => <path key={a} transform={`rotate(${a} ${x} 109)`} d={`M${x - 15} 109 h30`} opacity=".22" />)}</g>)}</g>}
      <g fill={dark} stroke={dark} strokeWidth="4" strokeLinecap="round">
        {recipe.eyes === 'round' && <>{[recipe.body === 'gpu' ? 70 : 78, recipe.body === 'gpu' ? 130 : 122].map(x => <circle key={x} cx={x} cy={eyeY} r="5" />)}</>}
        {recipe.eyes === 'sleepy' && <path d={`M70 ${eyeY} h13 M116 ${eyeY} h13`} />}
        {recipe.eyes === 'sparkle' && <path d={`M77 ${eyeY - 6} v12 M71 ${eyeY} h12 M122 ${eyeY - 6} v12 M116 ${eyeY} h12`} />}
        {recipe.eyes === 'visor' && <rect x="65" y={eyeY - 8} width="70" height="16" rx="8" />}
      </g>
      <g fill="none" stroke={dark} strokeWidth="4" strokeLinecap="round">
        {recipe.mouth === 'tiny' && <path d="M94 134 h12" />}
        {recipe.mouth === 'smile' && <path d="M88 130 Q100 145 112 130" />}
        {recipe.mouth === 'grin' && <path d="M84 129 h32 Q112 148 100 148 Q88 148 84 129 Z" fill={light} />}
        {recipe.mouth === 'surprised' && <ellipse cx="100" cy="135" rx="6" ry="8" fill={dark} />}
      </g>
      {recipe.accessory === 'antenna' && <g stroke={light} strokeWidth="4"><path d="M101 61 V30" /><circle cx="101" cy="25" r="7" fill={main} /></g>}
      {recipe.accessory === 'headphones' && <g fill={dark} stroke={light} strokeWidth="5"><path d="M44 102 C40 29 161 29 157 102" fill="none" /><rect x="37" y="94" width="13" height="32" rx="6" /><rect x="151" y="94" width="13" height="32" rx="6" /></g>}
      {recipe.accessory === 'sprout' && <g stroke={light} strokeWidth="3" fill={light}><path d="M101 62 V38 M101 47 C73 45 79 21 101 47 M102 44 C125 19 139 43 102 44" /></g>}
      {recipe.accessory === 'bolt' && <path d="M146 44 h-18 l-8 22 h13 l-6 21 27 -33 h-13 Z" fill={light} />}
    </svg>
  );
}
