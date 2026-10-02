/** Configuration reading: base-URL normalization and required key. */
import { describe, expect, it } from 'vitest'
import { ConfigError, readConfig } from '../src/config.ts'

const KEY = 'test-key'

describe('readConfig', () => {
  it('requires the API key and fails without one', () => {
    expect(() => readConfig({})).toThrow(/SENSENOVA_API_KEY is not set/)
  })

  it('normalizes accepted base-URL forms to the origin', () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, 'https://token.sensenova.cn'],
      ['https://token.sensenova.cn', 'https://token.sensenova.cn'],
      ['https://token.sensenova.cn/', 'https://token.sensenova.cn'],
      ['https://token.sensenova.cn/v1', 'https://token.sensenova.cn'],
      ['https://token.sensenova.cn/v1/images/generations', 'https://token.sensenova.cn'],
      ['https://token.sensenova.cn/v1/images/generations/', 'https://token.sensenova.cn'],
    ]
    for (const [raw, expected] of cases) {
      const env = raw === undefined ? { SENSENOVA_API_KEY: KEY } : { SENSENOVA_API_KEY: KEY, SENSENOVA_BASE_URL: raw }
      expect(readConfig(env as NodeJS.ProcessEnv).baseUrl).toBe(expected)
    }
  })

  it('rejects unknown paths, insecure schemes, and query strings', () => {
    expect(() => readConfig({ SENSENOVA_API_KEY: KEY, SENSENOVA_BASE_URL: 'https://token.sensenova.cn/other' } as NodeJS.ProcessEnv))
      .toThrow(ConfigError)
    expect(() => readConfig({ SENSENOVA_API_KEY: KEY, SENSENOVA_BASE_URL: 'http://token.sensenova.cn' } as NodeJS.ProcessEnv))
      .toThrow(/must use https/)
    expect(() => readConfig({ SENSENOVA_API_KEY: KEY, SENSENOVA_BASE_URL: 'https://token.sensenova.cn/v1?x=1' } as NodeJS.ProcessEnv))
      .toThrow(/query or fragment/)
  })

  it('keeps the configured model override', () => {
    expect(readConfig({ SENSENOVA_API_KEY: KEY, SENSENOVA_IMAGE_MODEL: 'sensenova-u1.5-fast' } as NodeJS.ProcessEnv).model)
      .toBe('sensenova-u1.5-fast')
  })
})
