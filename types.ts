
export enum VoiceName {
  ALGIEBA = 'Algieba',
  AOEDE = 'Aoede',
  CHARON = 'Charon',
  FENRIR = 'Fenrir',
  KORE = 'Kore',
  PUCK = 'Puck',
  ZEPHYR = 'Zephyr',
  ACHIRD = 'Achird',
  ENCELADUS = 'Enceladus'
}

export interface AudioGeneration {
  id: string;
  text: string;
  voice: VoiceName;
  timestamp: number;
  audioBlob?: Blob;
}

export interface SpeakerConfig {
  name: string;
  voice: VoiceName;
}
