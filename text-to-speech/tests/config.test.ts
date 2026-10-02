/** Environment configuration: endpoint derivation, validation, and defaults. */
import { describe, expect, it } from 'vitest'
import { ConfigError, readConfig } from '../src/config.ts'

describe('readConfig', () => {
  it('derives the Beijing workspace endpoint and applies official example defaults', () => {
    const config = readConfig({
      DASHSCOPE_API_KEY: 'sk-test',
      DASHSCOPE_WORKSPACE_ID: 'ws-1234',
    })
    expect(config.endpoint).toBe('https://ws-1234.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer')
    expect(config.model).toBe('qwen-audio-3.0-tts-flash')
    expect(config.defaultVoice).toBeUndefined()
  })

  it('keeps configured model and default voice overrides', () => {
    const config = readConfig({
      DASHSCOPE_API_KEY: 'sk-test',
      DASHSCOPE_WORKSPACE_ID: 'ws',
      DASHSCOPE_TTS_MODEL: 'qwen-audio-3.1-tts-flash',
      DASHSCOPE_TTS_VOICE: 'longanhuan_v3.1',
    })
    expect(config.model).toBe('qwen-audio-3.1-tts-flash')
    expect(config.defaultVoice).toBe('longanhuan_v3.1')
  })

  it('trims surrounding whitespace in optional overrides', () => {
    const config = readConfig({
      DASHSCOPE_API_KEY: ' sk-test ',
      DASHSCOPE_WORKSPACE_ID: ' ws-1 ',
      DASHSCOPE_TTS_VOICE: '  ',
    })
    expect(config.apiKey).toBe('sk-test')
    expect(config.endpoint).toBe('https://ws-1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer')
    expect(config.defaultVoice).toBeUndefined()
  })

  it('rejects a missing API key before any request', () => {
    expect(() => readConfig({ DASHSCOPE_WORKSPACE_ID: 'ws' }))
      .toThrow(ConfigError)
    expect(() => readConfig({ DASHSCOPE_WORKSPACE_ID: 'ws' }))
      .toThrow(/DASHSCOPE_API_KEY is not set/)
  })

  it('rejects a missing workspace ID', () => {
    expect(() => readConfig({ DASHSCOPE_API_KEY: 'sk-test' }))
      .toThrow(/DASHSCOPE_WORKSPACE_ID is not set/)
  })

  it('rejects a workspace ID that cannot form a subdomain', () => {
    expect(() => readConfig({ DASHSCOPE_API_KEY: 'sk-test', DASHSCOPE_WORKSPACE_ID: 'bad space!' }))
      .toThrow(/must contain only letters, digits, and dashes/)
  })
})
