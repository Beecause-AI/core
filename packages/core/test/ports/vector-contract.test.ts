import { vectorIndexContract } from '../../testing/port-contracts/vector.js';
import { InMemoryVectorIndex } from '../../src/adapters/vector/in-memory.js';

vectorIndexContract('in-memory', () => new InMemoryVectorIndex());
