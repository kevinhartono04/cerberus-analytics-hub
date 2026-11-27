import React from 'react';
import {createPortal} from 'react-dom';
import {Modal,Button} from './ui';
import {driveLink} from '../cue-media';

export default function DriveImport({source,type,onManual,onClose}) {
  return createPortal(<Modal title="Upload files manually" className="drive-import-modal" onClose={onClose}>
    <p>This demo cannot import files directly from Google Drive. If access is restricted, ask the file owner for access, then download the files and upload them here.</p>
    <small className="muted">Select multiple {type} files if they belong to this cue. Your existing attachments and source link will be kept.</small>
    {driveLink(source) && <a className="drive-source-link" href={source} target="_blank" rel="noreferrer">Open source in Google Drive ↗</a>}
    <div className="drive-permission-actions">
      <Button type="button" kind="primary" onClick={()=>{onClose();onManual();}}>Upload manually</Button>
      <Button type="button" onClick={onClose}>Cancel</Button>
    </div>
  </Modal>,document.querySelector(".sound-studio") || document.body);
}
