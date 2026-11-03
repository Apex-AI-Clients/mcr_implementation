import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CvlSettingsClient } from '../CvlSettingsClient'
import { readCvlSettings } from '@/lib/cvl/settings'

/** The CVL settings page: MCR's and the liquidator's details only. */

afterEach(() => cleanup())

describe('CvlSettingsClient', () => {
  it('asks for MCR’s company and the liquidator’s details, with nothing to confirm and no Form 509 placements', () => {
    render(<CvlSettingsClient initial={readCvlSettings([])} />)
    expect(screen.getByRole('heading', { name: 'MCR company details' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Liquidator details' })).toBeTruthy()
    expect(screen.queryByText(/where each amount goes/i)).toBeNull()
    expect(screen.queryByText(/to be confirmed/i)).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Confirmed/ })).toBeNull()
    expect(screen.queryByText(/Gabby/)).toBeNull()
  })
})
