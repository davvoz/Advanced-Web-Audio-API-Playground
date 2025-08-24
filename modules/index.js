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
import { TB303SequencerModule } from './tb303-sequencer.js';
import { DrumStationModule } from './drum-station.js';

export { Module, OscillatorModule, FilterModule, GainModule, DelayModule, ReverbModule, DistortionModule, MixerModule, DestinationModule, LFOModule, LFOSyncModule, ADSRModule, SequencerModule, TransportModule, SamplerModule, LooperModule, TB303Module, TB303SequencerModule, DrumStationModule };

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
  TB303Seq: TB303SequencerModule,
  DrumStation: DrumStationModule,
  // Aliases for constructor-based names used in exported patches
  TB303: TB303Module,
  TB303Sequencer: TB303SequencerModule,
  DrumStation: DrumStationModule,
};
