import { Module } from './module.js';
import { OscillatorModule } from './oscillator.js';
import { FilterModule } from './filter.js';
import { GainModule } from './gain.js';
import { DelayModule } from './delay.js';
import { ReverbModule } from './reverb.js';
import { DistortionModule } from './distortion.js';
import { MixerModule } from './mixer.js';
import { DestinationModule } from './destination.js';
import { LFOModule } from './lfo.js';
import { LFOSyncModule } from './lfosync.js';
import { ADSRModule } from './adsr.js';
import { SequencerModule } from './sequencer.js';
import { TransportModule } from './transport.js';
import { SamplerModule } from './sampler.js';
import { LooperModule } from './looper.js';
import { TB303Module } from './tb303.js';
import { DrumStationModule } from './drum-station.js';
import { EQ8Module } from './eq8.js';
import { FMModule } from './fm.js';
import { SidechainModule } from './sidechain.js';
import { GlueCompressorModule } from './glue-compressor.js';

export { Module, OscillatorModule, FilterModule, GainModule, DelayModule, ReverbModule, DistortionModule, MixerModule, DestinationModule, LFOModule, LFOSyncModule, ADSRModule, SequencerModule, TransportModule, SamplerModule, LooperModule, TB303Module, DrumStationModule, EQ8Module, FMModule, SidechainModule, GlueCompressorModule };

export const ModuleRegistry = {
  Oscillator: OscillatorModule,
  Filter: FilterModule,
  Gain: GainModule,
  Delay: DelayModule,
  Reverb: ReverbModule,
  Distortion: DistortionModule,
  Mixer: MixerModule,
  Destination: DestinationModule,
  LFO: LFOModule,
  LFOSync: LFOSyncModule,
  ADSR: ADSRModule,
  Sequencer: SequencerModule,
  Transport: TransportModule,
  Sampler: SamplerModule,
  Looper: LooperModule,
  TB303: TB303Module,
  DrumStation: DrumStationModule,
  EQ8: EQ8Module,
  FM: FMModule,
  Sidechain: SidechainModule,
  GlueCompressor: GlueCompressorModule,
  // Aliases for constructor-based names used in exported patches
  TB303: TB303Module,
  DrumStation: DrumStationModule,
  EQ8Module: EQ8Module,
  FMSynth: FMModule,
  SidechainModule: SidechainModule,
  GlueCompressorModule: GlueCompressorModule,
  // Aliases for UI labels (with spaces/hyphens)
  'Drum Station': DrumStationModule,
  'TB-303': TB303Module,
  'Sidechain': SidechainModule,
  'Glue Compressor': GlueCompressorModule,
};
