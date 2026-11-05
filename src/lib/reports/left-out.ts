/** Columns a weekly layout cannot show, in a sentence: "Clock in and Clock out are not shown. …" */
export function leftOutSentence(labels: string[]): string {
  const names = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${names} ${labels.length === 1 ? "is" : "are"} not shown. ${labels.length === 1 ? "It changes" : "They change"} from day to day, so ${labels.length === 1 ? "it" : "they"} cannot sit on a line that adds the days up.`;
}
