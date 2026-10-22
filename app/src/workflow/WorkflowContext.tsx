import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  INITIAL_WORKFLOW_STATE,
  workflowReducer,
  type WorkflowAction,
  type WorkflowStage,
  type WorkflowState,
} from './types';

interface WorkflowContextValue {
  state: WorkflowState;
  dispatch: Dispatch<WorkflowAction>;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export function WorkflowProvider({
  children,
  initialStage = INITIAL_WORKFLOW_STATE.stage,
}: {
  children: ReactNode;
  initialStage?: WorkflowStage;
}) {
  const [state, dispatch] = useReducer(workflowReducer, {
    ...INITIAL_WORKFLOW_STATE,
    stage: initialStage,
  });
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}

export function useWorkflow(): WorkflowContextValue {
  const ctx = useContext(WorkflowContext);
  if (!ctx) throw new Error('useWorkflow must be used within WorkflowProvider');
  return ctx;
}
