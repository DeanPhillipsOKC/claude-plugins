// One 5-hour reading: when it was taken (t), the percent used (p), and when
// that window resets (r), all times in epoch milliseconds.
export type Sample = { t: number; p: number; r: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-peaks': { samples: Sample[] }
  }
}
