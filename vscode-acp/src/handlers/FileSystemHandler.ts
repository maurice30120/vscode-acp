import * as vscode from 'vscode';
import { log, logError } from '../utils/Logger';

import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';

/**
 * Gere les requetes ACP de lecture/ecriture de fichiers via l'API workspace de VS Code.
 * Cela permet de prendre en compte automatiquement les buffers non enregistres.
 */
export class FileSystemHandler {

  /**
   * Lit un fichier texte en priorisant le contenu non enregistre ouvert dans l'editeur.
   */
  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    log(`readTextFile: ${params.path}`);

    try {
      const uri = vscode.Uri.file(params.path);

      // Verifie si le fichier est ouvert avec des modifications non enregistrees
      const openDoc = vscode.workspace.textDocuments.find(
        doc => doc.uri.fsPath === uri.fsPath
      );

      let content: string;
      if (openDoc) {
        content = openDoc.getText();
      } else {
        const raw = await vscode.workspace.fs.readFile(uri);
        content = Buffer.from(raw).toString('utf-8');
      }

      // Traite les parametres de decoupage par ligne/limite
      if (params.line !== undefined && params.line !== null
        || params.limit !== undefined && params.limit !== null) {
        const lines = content.split('\n');
        const startLine = (params.line ?? 1) - 1; // Convertit l'index 1-base en index 0-base
        const endLine = params.limit
          ? startLine + params.limit
          : lines.length;
        content = lines.slice(startLine, endLine).join('\n');
      }

      return { content };
    } catch (e) {
      logError(`readTextFile failed: ${params.path}`, e);
      throw e;
    }
  }

  /**
   * Ecrit un fichier texte et cree les dossiers parents si necessaire.
   * Ouvre le fichier ensuite dans l'editeur pour rendre les modifications visibles.
   */
  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    log(`writeTextFile: ${params.path}`);

    try {
      const uri = vscode.Uri.file(params.path);
      const encoded = Buffer.from(params.content, 'utf-8');

      await vscode.workspace.fs.writeFile(uri, encoded);

      // Ouvre le fichier dans l'editeur pour montrer immediatement le changement
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });

      return {};
    } catch (e) {
      logError(`writeTextFile failed: ${params.path}`, e);
      throw e;
    }
  }
}
