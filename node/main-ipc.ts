import { BrowserWindow } from 'electron';
const { powerSaveBlocker } = require('electron');
const dialog = require('electron').dialog;
const shell = require('electron').shell;

import * as path from 'path';
const fs = require('fs');
const trash = require('trash');
const spawn = require('child_process').spawn;

import { GLOBALS } from './main-globals';
import { ImageElement, FinalObject } from '../interfaces/final-object.interface';
import { SettingsObject } from '../interfaces/settings-object.interface';
import { createDotPlsFile, writeVhaFileToDisk } from './main-support';
import { replaceThumbnailWithNewImage } from './main-extract';

let preventSleepId: number;

/**
 * Set up the listeners
 * @param ipc
 * @param win
 * @param pathToAppData
 * @param systemMessages
 */
export function setUpIpcMessages(ipc, win, pathToAppData, systemMessages) {

  /**
   * Un-Maximize the window
   */
  ipc.on('un-maximize-window', (event) => {
    if (BrowserWindow.getFocusedWindow()) {
      BrowserWindow.getFocusedWindow().unmaximize();
    }
  });

  /**
   * Minimize the window
   */
  ipc.on('minimize-window', (event) => {
    if (BrowserWindow.getFocusedWindow()) {
      BrowserWindow.getFocusedWindow().minimize();
    }
  });

  /**
   * Prevent PC from going to sleep during screenshot extraction
   */
  ipc.on('prevent-sleep', (event) => {
    console.log('preventing sleep');
    preventSleepId = powerSaveBlocker.start('prevent-app-suspension');
  });

  /**
   * Allow PC to go to sleep after screenshots were extracted
   */
  ipc.on('allow-sleep', (event) => {
    console.log('allowing sleep');
    powerSaveBlocker.stop(preventSleepId);
  });

  /**
   * Open the explorer to the relevant file
   */
  ipc.on('open-in-explorer', (event, fullPath: string) => {
    shell.showItemInFolder(fullPath);
  });

  /**
   * Open a URL in system's default browser
   */
  ipc.on('please-open-url', (event, urlToOpen: string): void => {
    shell.openExternal(urlToOpen, { activate: true });
  });

  /**
   * Maximize the window
   */
  ipc.on('maximize-window', (event) => {
    if (BrowserWindow.getFocusedWindow()) {
      BrowserWindow.getFocusedWindow().maximize();
    }
  });

  /**
   * Open a particular video file clicked inside Angular
   */
  ipc.on('open-media-file', (event, fullFilePath) => {
    shell.openItem(path.normalize(fullFilePath)); // normalize because on windows, the path sometimes is mixing `\` and `/`
    // shell.openPath(path.normalize(fullFilePath)); // Electron 9
  });

  /**
   * Open a particular video file clicked inside Angular
   */
  ipc.on('open-media-file-at-timestamp', (event, executablePath, fullFilePath: string, argz: string[]) => {
    const allArgs: string[] = [];
    allArgs.push(path.normalize(fullFilePath));
    allArgs.push(...argz);
    console.log(allArgs);
    spawn(path.normalize(executablePath), allArgs);
  });

  /**
   * Select default video player
   */
  ipc.on('select-default-video-player', (event) => {
    console.log('asking for default video player');
    dialog.showOpenDialog(win, {
      title: systemMessages.selectDefaultPlayer, // TODO: check if errors out now that this is in `main-ipc.ts`
      filters: [
        {
          name: 'Executable', // TODO: i18n fixme
          extensions: ['exe', 'app']
        }, {
          name: 'All files', // TODO: i18n fixme
          extensions: ['*']
        }
      ],
      properties: ['openFile']
    }).then(result => {
      const executablePath: string = result.filePaths[0];
      if (executablePath) {
        event.sender.send('preferred-video-player-returning', executablePath);
      }
    }).catch(err => {});
  });

  /**
   * Create and play the playlist
   * 1. filter out *FOLDER*
   * 2. save .pls file
   * 3. ask OS to open the .pls file
   */
  ipc.on('please-create-playlist', (event, playlist: ImageElement[]) => {

    const cleanPlaylist: ImageElement[] = playlist.filter((element: ImageElement) => {
      return element.cleanName !== '*FOLDER*';
    });

    const savePath: string = path.join(pathToAppData, 'video-hub-app-2', 'temp.pls');

    if (cleanPlaylist.length) {
      createDotPlsFile(savePath, cleanPlaylist, () => {
        shell.openItem(savePath);
        // shell.openPath(savePath); // Electron 9
      });
    }
  });

  /**
   * Delete file from computer (send to recycling bin / trash) or dangerously delete (bypass trash)
   */
  ipc.on('delete-video-file', (event, item: ImageElement, dangerousDelete: boolean): void => {
    console.log('TODO: handle delete based on source folder!');
    const fileToDelete = path.join(GLOBALS.selectedSourceFolders[0].path, item.partialPath, item.fileName);

    if (dangerousDelete) {
      fs.unlink(fileToDelete, (err) => {
        if (err) {
          console.log(fileToDelete + ' was NOT deleted');
        }
      });
    } else {
      (async () => {
        await trash(fileToDelete);
      })();
    }

    // TODO --   handle async stuff better -- maybe wait before checking access?
    console.log('HANDLE ASYNC STUFF CORRECTLY !?');
    // check if file exists
    fs.access(fileToDelete, fs.F_OK, (err: any) => {
      if (err) {
        event.sender.send('file-deleted', item);
      }
    });

  });

  /**
   * Method to replace thumbnail of a particular item
   */
  ipc.on('replace-thumbnail', (event, pathToIncomingJpg: string, item: ImageElement) => {
    const fileToReplace: string = path.join(
        GLOBALS.selectedOutputFolder,
        'vha-' + GLOBALS.hubName,
        'thumbnails',
        item.hash + '.jpg'
      );

    if (fs.existsSync(fileToReplace)) {
      const height: number = GLOBALS.screenshotSettings.height;

      replaceThumbnailWithNewImage(fileToReplace, pathToIncomingJpg, height)
        .then(success => {
          if (success) {
            event.sender.send('thumbnail-replaced');
          }
        })
        .catch((err) => {});
    }
  });

  /**
   * Summon system modal to choose INPUT directory
   * where all the videos are located
   */
  ipc.on('choose-input', (event) => {
    dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    }).then(result => {
      const inputDirPath: string = result.filePaths[0];
      if (inputDirPath) {
        event.sender.send('inputFolderChosen', inputDirPath);
      }
    }).catch(err => {});
  });

  /**
   * Summon system modal to choose OUTPUT directory
   * where the final .vha2 file, vha-folder, and all screenshots will be saved
   */
  ipc.on('choose-output', (event) => {
    dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    }).then(result => {
      const outputDirPath: string = result.filePaths[0];
      if (outputDirPath) {
        event.sender.send('outputFolderChosen', outputDirPath);
      }
    }).catch(err => {});
  });

  /**
   * Try to rename the particular file
   */
  ipc.on('try-to-rename-this-file', (event, sourceFolder: string, relPath: string, file: string, renameTo: string, index: number): void => {
    console.log('renaming file:');

    const original: string = path.join(sourceFolder, relPath, file);
    const newName: string = path.join(sourceFolder, relPath, renameTo);

    console.log(original);
    console.log(newName);

    let success = true;
    let errMsg: string;

    // check if already exists first
    if (fs.existsSync(newName)) {
      console.log('some file already EXISTS WITH THAT NAME !!!');
      success = false;
      errMsg = 'RIGHCLICK.errorFileNameExists';
    } else {
      try {
        fs.renameSync(original, newName);
      } catch (err) {
        success = false;
        console.log(err);
        if (err.code === 'ENOENT') {
          // const pathObj = path.parse(err.path);
          // console.log(pathObj);
          errMsg = 'RIGHTCLICK.errorFileNotFound';
        } else {
          errMsg = 'RIGHTCLICK.errorSomeError';
        }
      }
    }

    event.sender.send('renameFileResponse', index, success, renameTo, file, errMsg);
  });

  /**
   * Close the window / quit / exit the app
   */
  ipc.on('close-window', (event, settingsToSave: SettingsObject, finalObjectToSave: FinalObject) => {

    // save window size and position
    settingsToSave.windowSizeAndPosition = GLOBALS.winRef.getContentBounds(); // unsure why `win` doesn't work here

    // convert shortcuts map to object
    // someday when node stops giving error: Property 'fromEntries' does not exist on type 'ObjectConstructor'
    // settingsToSave.shortcuts = <any>Object.fromEntries(settingsToSave.shortcuts);
    // until then: https://gist.github.com/lukehorvat/133e2293ba6ae96a35ba#gistcomment-2600839
    let obj = Array.from(settingsToSave.shortcuts).reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {});
    settingsToSave.shortcuts = <any>obj;

    const json = JSON.stringify(settingsToSave);

    try {
      fs.statSync(path.join(pathToAppData, 'video-hub-app-2'));
    } catch (e) {
      fs.mkdirSync(path.join(pathToAppData, 'video-hub-app-2'));
    }

    // TODO -- catch bug if user closes before selecting the output folder ?!??
    fs.writeFile(path.join(pathToAppData, 'video-hub-app-2', 'settings.json'), json, 'utf8', () => {
      if (finalObjectToSave !== null) {

        writeVhaFileToDisk(finalObjectToSave, GLOBALS.currentlyOpenVhaFile, () => {
          try {
            BrowserWindow.getFocusedWindow().close();
          } catch {}
        });

      } else {
        try {
          BrowserWindow.getFocusedWindow().close();
        } catch {}
      }
    });
  });

}
