/** [Gate PlanB-P8] もしもの案(FR-019)の前の URL → 旅程(日ごとの案のタブで案を作る・切り替える) */
import { Navigate, useParams } from 'react-router-dom';

export default function BranchesMoved() {
  const { planId } = useParams<{ planId: string }>();
  return <Navigate to={planId ? `/planner/${planId}` : '/planner'} replace />;
}
