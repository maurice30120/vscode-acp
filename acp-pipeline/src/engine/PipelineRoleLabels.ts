import type { PipelineDefinition } from '../PipelineTypes';
import type { PipelineStatus } from '../PipelineEvents';

export function buildRevisionPrompt(originalUserPrompt: string, currentPlan: string, feedback: string): string {
  return [
    'Original user request:',
    originalUserPrompt,
    '',
    'Current proposed plan:',
    currentPlan,
    '',
    'User revision request:',
    feedback,
    '',
    'Revise the plan based on the user\'s feedback.',
    'Return exactly one <proposed_plan>...</proposed_plan> block.',
  ].join('\n');
}

export function getPipelineStepPhase(pipeline: PipelineDefinition, stepId: string): PipelineStatus {
  const role = getPipelineStepRole(pipeline, stepId);
  if (role === 'reviewer') {
    return 'reviewing';
  }
  if (role === 'tester') {
    return 'testing';
  }
  if (role === 'implementer') {
    return 'implementing';
  }

  let approvalSeen = false;
  for (const step of pipeline.steps) {
    if (step.id === stepId) {
      if (stepId === 'implementer' || (approvalSeen && stepId !== 'planner')) {
        return 'implementing';
      }
      return approvalSeen ? 'implementing' : 'planning';
    }
    if ('type' in step && step.type === 'approval') {
      approvalSeen = true;
    }
  }
  return 'planning';
}

export function getPipelineStepRole(pipeline: PipelineDefinition, stepId: string): string {
  const primitiveId = findPrimitiveIdForStep(pipeline, stepId);
  const candidates = [stepId, primitiveId].filter((value): value is string => Boolean(value));
  if (candidates.some(value => value === 'planner' || value === 'plan')) {
    return 'planner';
  }
  if (candidates.some(value => value === 'implementer' || value === 'implement')) {
    return 'implementer';
  }
  if (candidates.some(value => value === 'reviewer' || value === 'review' || value === 'verifier' || value === 'verify')) {
    return 'reviewer';
  }
  if (candidates.some(value => value === 'tester' || value === 'test')) {
    return 'tester';
  }
  return stepId;
}

export function findPlannerStepId(pipeline: PipelineDefinition): string {
  for (const step of pipeline.steps) {
    if ('type' in step && step.type === 'approval') {
      break;
    }
    if ('use' in step) {
      const primitive = pipeline.primitives[step.use];
      if (primitive.output === 'proposed_plan') {
        return step.id;
      }
    }
  }
  throw new Error('Pipeline has no planner step with proposed_plan output.');
}

function findPrimitiveIdForStep(pipeline: PipelineDefinition, stepId: string): string | undefined {
  for (const step of pipeline.steps) {
    if ('use' in step && step.id === stepId) {
      return step.use;
    }
    if ('type' in step && step.type === 'parallel') {
      const branch = step.branches.find(candidate => `${step.id}/${candidate.id}` === stepId);
      if (branch) {
        return branch.use;
      }
    }
  }
  return undefined;
}
