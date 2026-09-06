import { describe, expect, it } from 'vitest'
import styles from './styles.css?raw'

describe('Android plan layout', () => {
  it('uses one vertical viewport scroll instead of a nested plan-list scroll', () => {
    const mobileRules = styles.slice(
      styles.indexOf('/* Android plan dialogs:'),
      styles.indexOf('.admin-referral-stats'),
    )

    expect(mobileRules).toMatch(/\.modal--plans,[\s\S]*?overflow-y:\s*auto;/)
    expect(mobileRules).toMatch(/\.modal--plans > \.plan-list[\s\S]*?overflow:\s*visible;/)
    expect(mobileRules).toMatch(/\.modal--plan-summary \.plan-summary__content[\s\S]*?overflow:\s*visible;/)
    expect(mobileRules).toMatch(/touch-action:\s*pan-y;/)
  })
})
