import React from 'react';
import { useStaticQuery, graphql } from 'gatsby';
import EducationItem from './EducationItem';
import Timeline from '../../Timeline';
import Section from '../Section';
import { injectIntl } from 'react-intl';

const Education = ({ intl: { locale } }) => {
  const data = useStaticQuery(graphql`
    query {
      allMarkdownRemark(
        filter: { fields: { sourceName: { eq: "educations" } } }
        sort: { fields: frontmatter___date, order: DESC }
      ) {
        edges {
          node {
            id
            html
            fileAbsolutePath
            frontmatter {
              institution
              studyType
              area
              gpa
              date
            }
          }
        }
      }
    }
  `);

  return (
    <Section id="education" title="Education">
      <Timeline>
        {data.allMarkdownRemark.edges
          .filter(({ node: { fileAbsolutePath } }) =>
            fileAbsolutePath.endsWith(`.${locale}.md`)
          )
          .map(
            ({
              node: {
                id,
                html,
                frontmatter: { institution, studyType, area, gpa, date },
              },
            }) => (
              <EducationItem
                key={id}
                institution={institution}
                studyType={studyType}
                area={area}
                description={html}
                gpa={gpa}
                date={date}
              />
            )
          )}
      </Timeline>
    </Section>
  );
};

export default injectIntl(Education);
