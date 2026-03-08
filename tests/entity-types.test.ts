import { Agent, SDK } from '../src/index.js';

describe('Entity type creation and mutation', () => {
  const sdk = new SDK({ chainId: 1, rpcUrl: 'http://localhost:8545' });

  it('[R2] createEntity returns Agent and sets entityType', () => {
    const agent = sdk.createEntity({
      entityType: 'tool',
      name: 'Tool',
      description: 'Desc',
    });

    expect(agent).toBeInstanceOf(Agent);
    expect(agent.entityType).toBe('tool');
    expect(agent.getRegistrationFile().entityType).toBe('tool');
  });

  it('[R1,R4] createAgent remains default and entityType getter returns agent', () => {
    const agent = sdk.createAgent('Agent', 'Desc');
    expect(agent.entityType).toBe('agent');
    expect(
      agent.getRegistrationFile().entityType === undefined ||
        agent.getRegistrationFile().entityType === 'agent'
    ).toBe(true);
  });

  it('[R3] wrapper constructors set canonical entity types', () => {
    expect(sdk.createHuman('H', 'd').entityType).toBe('human');
    expect(sdk.createTool('T', 'd').entityType).toBe('tool');
    expect(sdk.createSkill('S', 'd').entityType).toBe('skill');
    expect(sdk.createExperience('E', 'd').entityType).toBe('experience');
    expect(sdk.createHouse('H2', 'd').entityType).toBe('house');
    expect(sdk.createOrganization('O', 'd').entityType).toBe('organization');
  });

  it('[R5] setEntityType updates updatedAt', () => {
    const agent = sdk.createAgent('A', 'd');
    const prev = agent.getRegistrationFile().updatedAt;
    agent.setEntityType('human');
    expect(agent.entityType).toBe('human');
    expect(agent.getRegistrationFile().updatedAt).toBeGreaterThanOrEqual(prev);
  });

  it('[R6] custom entityType string is preserved', () => {
    const agent = sdk.createAgent('A', 'd');
    agent.setEntityType('x-custom-entity');
    expect(agent.entityType).toBe('x-custom-entity');
    expect(agent.getRegistrationFile().entityType).toBe('x-custom-entity');
  });
});
