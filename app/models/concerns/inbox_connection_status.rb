# frozen_string_literal: true

module InboxConnectionStatus
  private

  def api_connection_status
    attributes = channel.additional_attributes.to_h
    return 'unknown' if connection_status_stale?(attributes['connection_status_checked_at'], CONNECTION_STATUS_TTL)

    attributes['connection_status'].presence_in(%w[connected disconnected]) || 'unknown'
  end

  def whatsapp_connection_status
    return 'unknown' unless channel.is_a?(Channel::Whatsapp) && channel.provider == 'whatsapp_cloud'
    return 'unknown' if connection_status_stale?(channel.phone_number_health_checked_at, WHATSAPP_HEALTH_STATUS_TTL)

    status = channel.phone_number_health.to_h['status'].to_s.upcase
    return 'disconnected' if UNHEALTHY_WHATSAPP_STATUSES.include?(status) || channel.phone_number_health_error.present?
    return 'connected' if HEALTHY_WHATSAPP_STATUSES.include?(status)

    'unknown'
  end

  def connection_status_stale?(checked_at, ttl)
    checked_at = Time.zone.parse(checked_at) if checked_at.is_a?(String)
    checked_at.blank? || checked_at < ttl.ago
  end
end
