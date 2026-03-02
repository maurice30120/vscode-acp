import * as vscode from 'vscode';
import { TelemetryReporter } from '@vscode/extension-telemetry';

const CONNECTION_STRING = 'InstrumentationKey=c4d676c8-3b21-4047-8f57-804f20ccb62d';

let reporter: TelemetryReporter | undefined;

/** Proprietes communes ajoutees a tous les evenements de telemetrie. */
function getCommonProperties(): Record<string, string> {
  return {
    ideName: vscode.env.appName,
    ideUriScheme: vscode.env.uriScheme,
    ideAppHost: vscode.env.appHost,
  };
}

/**
 * Initialise le reporter de telemetrie. Doit etre appele une seule fois pendant
 * `activate()`. Retourne le reporter afin de l'ajouter a
 * `context.subscriptions` pour une liberation automatique.
 */
export function initTelemetry(): TelemetryReporter {
  if (reporter) {
    return reporter;
  }
  reporter = new TelemetryReporter(CONNECTION_STRING);
  return reporter;
}

/**
 * Envoie un evenement de telemetrie nomme avec des proprietes texte optionnelles et
 * des mesures numeriques.
 */
export function sendEvent(
  eventName: string,
  properties?: Record<string, string>,
  measurements?: Record<string, number>,
): void {
  reporter?.sendTelemetryEvent(eventName, { ...getCommonProperties(), ...properties }, measurements);
}

/**
 * Envoie un evenement d'erreur (hors exception). Les proprietes decrivent le contexte
 * de l'erreur ; les donnees passent quand meme par le pipeline normal.
 */
export function sendError(
  eventName: string,
  properties?: Record<string, string>,
  measurements?: Record<string, number>,
): void {
  reporter?.sendTelemetryErrorEvent(eventName, { ...getCommonProperties(), ...properties }, measurements);
}

/**
 * Remonte une exception (ou erreur capturee) comme evenement d'erreur.
 */
export function sendException(error: Error, properties?: Record<string, string>): void {
  reporter?.sendTelemetryErrorEvent('unhandledException', {
    ...getCommonProperties(),
    ...properties,
    errorName: error.name,
    errorMessage: error.message,
  });
}
