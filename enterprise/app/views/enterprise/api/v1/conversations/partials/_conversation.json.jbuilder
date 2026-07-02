# NODO PATCH 10: sin SLA aplicada (sla_policy_id es columna, ya en memoria) no
# hay nada que serializar — evita 2 queries de SLA por conversación en la lista.
if conversation.sla_policy_id.present? && conversation.account.feature_enabled?('sla')
  json.applied_sla do
    json.partial! 'api/v1/models/applied_sla', formats: [:json], resource: conversation.applied_sla if conversation.applied_sla.present?
  end
  json.sla_events do
    json.array! conversation.sla_events do |sla_event|
      json.partial! 'api/v1/models/sla_event', formats: [:json], sla_event: sla_event
    end
  end
end
