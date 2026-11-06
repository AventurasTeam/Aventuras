import Root from './responsive-modal.svelte'
import Content from './responsive-modal-content.svelte'
import Header from './responsive-modal-header.svelte'
import Footer from './responsive-modal-footer.svelte'
import Title from './responsive-modal-title.svelte'
import Description from './responsive-modal-description.svelte'
import Trigger from './responsive-modal-trigger.svelte'
import Close from './responsive-modal-close.svelte'
export { getResponsiveModalContext } from './context'

export {
  Root,
  Content,
  Header,
  Footer,
  Title,
  Description,
  Trigger,
  Close,
  // Aliases
  Root as ResponsiveModal,
  Content as ResponsiveModalContent,
  Header as ResponsiveModalHeader,
  Footer as ResponsiveModalFooter,
  Title as ResponsiveModalTitle,
  Description as ResponsiveModalDescription,
  Trigger as ResponsiveModalTrigger,
  Close as ResponsiveModalClose,
}
