# == Schema Information
#
# Table name: canned_responses
#
#  id         :integer          not null, primary key
#  content    :text
#  short_code :string
#  created_at :datetime         not null
#  updated_at :datetime         not null
#  account_id :integer          not null
#

class CannedResponse < ApplicationRecord
  include AccountCacheRevalidator
  include Rails.application.routes.url_helpers

  validates :content, presence: true
  validates :short_code, presence: true
  validates :account, presence: true
  validates :short_code, uniqueness: { scope: :account_id }

  belongs_to :account
  has_many_attached :files

  # Rich quick replies use the same Active Storage service as Chatwoot messages.
  # On this installation that service is Supabase Storage, so the media never
  # leaves the Otronodo project.
  def file_base_data
    files.map do |file|
      {
        id: file.id,
        file_type: file.content_type,
        file_url: url_for(file),
        blob_signed_id: file.blob.signed_id,
        filename: file.filename.to_s,
        byte_size: file.byte_size
      }
    end
  end

  def as_json(options = nil)
    super(options).merge('files' => file_base_data)
  end

  scope :order_by_search, lambda { |search|
    short_code_starts_with = sanitize_sql_array(['WHEN short_code ILIKE ? THEN 1', "#{search}%"])
    short_code_like = sanitize_sql_array(['WHEN short_code ILIKE ? THEN 0.5', "%#{search}%"])
    content_like = sanitize_sql_array(['WHEN content ILIKE ? THEN 0.2', "%#{search}%"])

    order_clause = "CASE #{short_code_starts_with} #{short_code_like} #{content_like} ELSE 0 END"

    order(Arel.sql(order_clause) => :desc)
  }
end
