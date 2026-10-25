/**
 * Checks on an AI summary's figures. Pure.
 *
 * Every dollar figure the summary states must be one of the dollar figures it
 * was given (the ones in its prompt), or the difference between two of them,
 * within 1% (or within the rounding the summary itself used, e.g. "$1.2
 * million"). A figure that is none of those — a sum of three years' profits
 * presented as retained earnings, a number made up — fails the summary.
 */

export interface StatedFigure {
  text: string
  value: number
  /** How far the figure may be from the truth given how it was written. */
  rounding: number
}

const FIGURE = /(-)?\$\s?\(?(\d[\d,]*(?:\.\d+)?)\)?\s*(k|m|bn|b|thousand|million|billion)?\b/gi

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
}

/** Every dollar figure in a text, as a magnitude. */
export function statedFigures(text: string): StatedFigure[] {
  const out: StatedFigure[] = []
  for (const m of text.matchAll(FIGURE)) {
    const digits = m[2].replace(/,/g, '')
    const scale = m[3] ? SCALE[m[3].toLowerCase()] : 1
    const decimals = digits.includes('.') ? digits.split('.')[1].length : 0
    out.push({
      text: m[0].trim(),
      value: Math.abs(parseFloat(digits) * scale),
      rounding: m[3] ? 0.5 * scale * 10 ** -decimals : 0,
    })
  }
  return out
}

/** The dollar figures a prompt gives the model: the only ones its answer may state. */
export function promptFigures(prompt: string): number[] {
  return [...new Set(statedFigures(prompt).map((f) => f.value))]
}

/** A stated figure that is an input, or the difference between two inputs. */
function supported(figure: StatedFigure, inputs: number[]): boolean {
  const fits = (truth: number) => Math.abs(figure.value - truth) <= Math.max(0.01 * Math.abs(truth), figure.rounding, 0.5)
  if (figure.value === 0) return true
  if (inputs.some(fits)) return true
  for (let i = 0; i < inputs.length; i++) {
    for (let j = i + 1; j < inputs.length; j++) {
      if (fits(Math.abs(inputs[i] - inputs[j]))) return true
    }
  }
  return false
}

/** The summary's figures that are not in, or the difference of two of, its inputs. */
export function unsupportedFigures(text: string, inputs: number[]): string[] {
  return statedFigures(text)
    .filter((f) => !supported(f, inputs))
    .map((f) => f.text)
}
