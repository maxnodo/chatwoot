# NODO PATCH 10: short-circuit por sla_policy_id (columna, ya en memoria) para
# evitar 2 queries de SLA por conversación en la lista. Se combina con el
# chequeo de contacto bloqueado (sla_applicable?) que agregó upstream en 4.16.0.
if conversation.account.feature_enabled?('sla')
  if conversation.sla_policy_id.present? && conversation.sla_applicable?
    json.applied_sla do
      json.partial! 'api/v1/models/applied_sla', formats: [:json], resource: conversation.applied_sla if conversation.applied_sla.present?
    end
    json.sla_events do
      json.array! conversation.sla_events do |sla_event|
        json.partial! 'api/v1/models/sla_event', formats: [:json], sla_event: sla_event
      end
    end
  else
    json.applied_sla nil
    json.sla_events []
  end
end
