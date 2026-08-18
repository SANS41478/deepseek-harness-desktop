/**
 * In-window title bar: the injected CSS shifts the mount root below the bar
 * and makes the bar a drag region, and the injected DOM carries the app title
 * with a spacer reserved for the native window-button overlay.
 */
import { describe, expect, it } from 'vitest'
import { TITLE_BAR_HEIGHT } from '../src/main/title-bar.ts'

describe('title bar constants', () => {
  it('matches the Windows titleBarOverlay height', () => {
    expect(TITLE_BAR_HEIGHT).toBe(36)
  })
})
