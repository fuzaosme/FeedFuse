import type { Category } from '../../../types';
import FeedDialog, { type FeedDialogSubmitPayload } from './FeedDialog';
import type { FeedDialogInitialValues } from '../feedDialog.types';

interface AddFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  initialValues?: Partial<FeedDialogInitialValues>;
  onSubmit: (payload: FeedDialogSubmitPayload) => Promise<void>;
}

export default function AddFeedDialog({ open, onOpenChange, categories, initialValues, onSubmit }: AddFeedDialogProps) {
  return (
    <FeedDialog
      mode="add"
      open={open}
      onOpenChange={onOpenChange}
      categories={categories}
      initialValues={initialValues}
      onSubmit={onSubmit}
    />
  );
}
